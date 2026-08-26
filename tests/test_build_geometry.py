"""Tests for the SIRUTA join key.

The two sources type SIRUTA differently — int in the WFS, string in the API — so every row
in the map depends on these two representations normalising to the same value. Leading
zeros are the classic way this join silently loses rows, which is precisely the failure the
brief says must never happen quietly.
"""

import pandas as pd

from pipeline.build_geometry import normalise_siruta


class TestNormaliseSiruta:
    def test_int_and_string_agree(self) -> None:
        from_wfs = normalise_siruta(pd.Series([74867, 114079, 111783]))
        from_api = normalise_siruta(pd.Series(["74867", "114079", "111783"]))
        assert list(from_wfs) == list(from_api)

    def test_strips_leading_zeros_on_both_sides(self) -> None:
        # An int column cannot carry a leading zero, so a zero-padded string from the API
        # must normalise to the same key or the row is silently dropped.
        assert list(normalise_siruta(pd.Series(["060598"]))) == ["60598"]
        assert list(normalise_siruta(pd.Series([60598]))) == ["60598"]

    def test_strips_float_suffix(self) -> None:
        # A column containing any NaN is read back as float64, turning 74867 into
        # "74867.0". Left unhandled, that misses every single row.
        assert list(normalise_siruta(pd.Series([74867.0]))) == ["74867"]

    def test_strips_whitespace(self) -> None:
        assert list(normalise_siruta(pd.Series([" 74867 "]))) == ["74867"]

    def test_all_zeros_does_not_become_empty(self) -> None:
        # Guard on the lstrip: "0" must not normalise to "", which would collide with
        # every other empty value and merge unrelated UATs.
        assert list(normalise_siruta(pd.Series(["0"]))) == ["0"]
        assert list(normalise_siruta(pd.Series(["000"]))) == ["0"]

    def test_distinct_codes_stay_distinct(self) -> None:
        codes = pd.Series(["1", "01", "10", "100", "0100"])
        assert list(normalise_siruta(codes)) == ["1", "1", "10", "100", "100"]

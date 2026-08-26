"""Tests for seat name matching.

Seats decide candidacy: a UAT is absorbable if its seat point falls inside an absorber's
buffer. Matching the wrong village moves that point by kilometres, so the folding rules
need to be permissive enough to survive Romanian declension and strict enough not to
conflate two genuinely different villages.
"""

import pytest

from pipeline.build_seats import normalise_name, normalise_name_loose


class TestNormaliseName:
    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            ("Comuna Valea Lupului", "VALEA LUPULUI"),
            ("MUNICIPIUL TÂRGU MUREȘ", "TARGU MURES"),
            ("ORAȘ EFORIE", "EFORIE"),
            ("Sectorul 1", "1"),
        ],
    )
    def test_strips_administrative_prefix(self, raw: str, expected: str) -> None:
        assert normalise_name(raw) == expected

    def test_folds_both_romanian_diacritic_conventions(self) -> None:
        # The sources disagree: one uses comma-below (ș, ț), the other cedilla (ş, ţ).
        # NFKD does not decompose the comma-below forms, so they are mapped explicitly.
        assert normalise_name("Sâncraiu de Mureș") == normalise_name("Sâncraiu de Mureş")
        assert normalise_name("Hărmăneşti") == "HARMANESTI"

    def test_case_and_punctuation_insensitive(self) -> None:
        assert normalise_name("SÂRBII - MĂGURA") == normalise_name("Sârbii-Măgura")

    def test_distinct_names_stay_distinct(self) -> None:
        assert normalise_name("Albești") != normalise_name("Cândești")


class TestNormaliseNameLoose:
    @pytest.mark.parametrize(
        ("uat", "locality"),
        [
            ("ALBEȘTII DE MUSCEL", "Albești de Muscel"),
            ("HĂRMĂNEȘTI", "Hărmănești"),
            ("PORUMBENI", "Porumbeni"),
        ],
    )
    def test_definite_article_plural_folds(self, uat: str, locality: str) -> None:
        # A commune and its seat village are often the same word in different grammatical
        # forms; "-ii" and "-i" must compare equal.
        assert normalise_name_loose(uat) == normalise_name_loose(locality)

    def test_fold_applies_per_word_not_just_at_the_end(self) -> None:
        assert normalise_name_loose("ALBEȘTII DE MUSCEL") == "ALBESTI DE MUSCEL"

    def test_does_not_conflate_different_villages(self) -> None:
        # The whole point of folding rather than fuzzy-matching: these must stay apart.
        assert normalise_name_loose("Porumbenii Mari") != normalise_name_loose("Porumbenii Mici")
        assert normalise_name_loose("Hărmăneștii Noi") != normalise_name_loose("Hărmăneștii Vechi")
        assert normalise_name_loose("Râu Alb de Jos") != normalise_name_loose("Râu Alb de Sus")

    def test_does_not_fold_unrelated_double_i(self) -> None:
        # "II" only folds at a word boundary, so an interior sequence is untouched.
        assert normalise_name_loose("Albestiu") == "ALBESTIU"

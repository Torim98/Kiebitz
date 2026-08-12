pub(crate) const DEFAULT_RATING: i64 = 1500;

const ELO_K: f64 = 24.0;

pub(crate) fn elo_after(before: i64, puzzle_rating: i64, solved: bool) -> i64 {
    let expected = 1.0 / (1.0 + 10f64.powf((puzzle_rating - before) as f64 / 400.0));
    let score = if solved { 1.0 } else { 0.0 };
    (before as f64 + ELO_K * (score - expected)).round() as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn solved_and_failed_attempts_move_rating_in_expected_direction() {
        assert!(elo_after(DEFAULT_RATING, DEFAULT_RATING, true) > DEFAULT_RATING);
        assert!(elo_after(DEFAULT_RATING, DEFAULT_RATING, false) < DEFAULT_RATING);
    }
}

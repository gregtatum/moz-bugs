// @ts-check

/**
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function levenshtein(a, b) {
  const rows = a.length + 1;
  const cols = b.length + 1;

  const dp = [];
  for (let i = 0; i < rows; i++) {
    dp[i] = new Array(cols).fill(0);
  }
  for (let i = 0; i < rows; i++) dp[i][0] = i;
  for (let j = 0; j < cols; j++) dp[0][j] = j;

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }

  return dp[rows - 1][cols - 1];
}

/**
 * Returns the closest candidate to input by Levenshtein distance, or null if
 * no candidate is within half the input's length.
 * @param {string} input
 * @param {string[]} candidates
 * @returns {string | null}
 */
export function closestMatch(input, candidates) {
  let best = null;
  let bestDist = Infinity;

  for (const candidate of candidates) {
    const dist = levenshtein(input, candidate);
    if (dist < bestDist) {
      bestDist = dist;
      best = candidate;
    }
  }

  const threshold = Math.floor(input.length / 2);
  return bestDist <= threshold ? best : null;
}

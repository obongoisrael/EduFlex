/**
 * Resource Quality Score service (Phase 2 §9).
 *
 * Scores a resource 0–100 from community signals + metadata completeness:
 *   - upvotes            up to 30 pts
 *   - views + downloads  up to 20 pts
 *   - metadata quality   up to 30 pts (title, description, code, category, institution)
 *   - recency            up to 15 pts (old resources fade unless well upvoted)
 *   - institution match  up to  5 pts (highlighted, never dominant)
 */

/**
 * @param {object} r resource row
 * @param {string} [viewerInstitution] institution of the student viewing it
 * @returns {{ score: number, label: string }}
 */
function qualityScore(r, viewerInstitution) {
  let score = 0;

  // Community approval
  score += Math.min(30, (r.upvotes_count || 0) * 8);
  score += Math.min(20, ((r.views_count || 0) + (r.downloads_count || 0)) * 2);

  // Metadata completeness — well-described resources are easier to trust
  if ((r.title || '').length >= 8) score += 6; else if (r.title) score += 3;
  if ((r.description || '').length >= 20) score += 8; else if (r.description) score += 4;
  if (r.course_code) score += 6;
  if (r.category) score += 5;
  if (r.institution) score += 5;

  // Recency — but heavy upvotes keep old resources relevant
  const ageDays = (Date.now() - new Date(r.created_at).getTime()) / 86400000;
  if (ageDays <= 30) score += 15;
  else if (ageDays <= 90) score += 10;
  else if (ageDays <= 365) score += 6;
  else score += (r.upvotes_count || 0) >= 3 ? 6 : 2;

  // Same-institution highlight (small, so it never unfairly outranks others)
  if (viewerInstitution && r.institution === viewerInstitution) score += 5;

  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, label: qualityLabel(score) };
}

function qualityLabel(score) {
  if (score >= 80) return 'Highly Recommended';
  if (score >= 60) return 'Good Resource';
  if (score >= 40) return 'Average';
  return 'Low Confidence';
}

module.exports = { qualityScore, qualityLabel };

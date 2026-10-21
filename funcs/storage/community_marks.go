package storage

import (
	"fmt"
	"strings"
)

// CommunityProfileMarkCounts describes the two directions of a member's marks.
// MarkedMe is the number of accounts that marked this member. MarkedByMe is the
// number of accounts this member has marked.
type CommunityProfileMarkCounts struct {
	MarkedMe   int64 `json:"markedMe"`
	MarkedByMe int64 `json:"markedByMe"`
}

// GetCommunityProfileMarkCounts returns the current user's incoming and
// outgoing mark counts from the existing community_friend_marks table.
func GetCommunityProfileMarkCounts(userID int64) (CommunityProfileMarkCounts, error) {
	var counts CommunityProfileMarkCounts
	if DB == nil || userID <= 0 {
		return counts, fmt.Errorf("invalid database or user ID")
	}

	err := DB.QueryRow(`
        SELECT
            (SELECT COUNT(*) FROM community_friend_marks WHERE target_user_id = ?),
            (SELECT COUNT(*) FROM community_friend_marks WHERE user_id = ?)
    `, userID, userID).Scan(&counts.MarkedMe, &counts.MarkedByMe)
	if err != nil {
		return CommunityProfileMarkCounts{}, fmt.Errorf("load profile mark counts: %w", err)
	}
	return counts, nil
}

// ListCommunityProfileMarks returns up to limit public profiles in either
// direction. direction must be "marked-me" or "marked-by-me". total is the
// full count, even when the returned list is limited.
func ListCommunityProfileMarks(userID int64, direction string, limit int) ([]CommunityMember, int64, error) {
	if DB == nil || userID <= 0 {
		return nil, 0, fmt.Errorf("invalid database or user ID")
	}
	if limit < 1 || limit > 100 {
		limit = 100
	}

	direction = strings.ToLower(strings.TrimSpace(direction))
	var where string
	var countQuery string
	switch direction {
	case "marked-me":
		// The target is me; list the users who marked me.
		where = "fm.target_user_id = ? AND fm.user_id = u.id"
		countQuery = `SELECT COUNT(*) FROM community_friend_marks WHERE target_user_id = ?`
	case "marked-by-me":
		// I am the source; list the users I marked.
		where = "fm.user_id = ? AND fm.target_user_id = u.id"
		countQuery = `SELECT COUNT(*) FROM community_friend_marks WHERE user_id = ?`
	default:
		return nil, 0, fmt.Errorf("unknown profile mark direction")
	}

	var total int64
	if err := DB.QueryRow(countQuery, userID).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count profile marks: %w", err)
	}

	query := `
        SELECT
            u.id,
            u.public_id,
            u.username,
            u.full_name,
            CAST(u.created_at AS TEXT),
            (SELECT COUNT(*) FROM community_friend_marks incoming WHERE incoming.target_user_id = u.id) AS friend_count,
            EXISTS(SELECT 1 FROM community_friend_marks mine WHERE mine.user_id = ? AND mine.target_user_id = u.id) AS marked_by_me
        FROM community_friend_marks fm
        JOIN users u ON u.id = CASE
            WHEN ? = 'marked-me' THEN fm.user_id
            ELSE fm.target_user_id
        END
        WHERE ` + where + `
        ORDER BY lower(u.username), lower(u.full_name), u.id
        LIMIT ?
    `

	rows, err := DB.Query(query, userID, direction, userID, limit)
	if err != nil {
		return nil, 0, fmt.Errorf("query profile mark list: %w", err)
	}
	defer rows.Close()

	members := make([]CommunityMember, 0, min(limit, int(total)))
	for rows.Next() {
		member, scanErr := scanCommunityMember(rows)
		if scanErr != nil {
			return nil, 0, fmt.Errorf("scan profile mark member: %w", scanErr)
		}
		members = append(members, member)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("iterate profile mark list: %w", err)
	}
	return members, total, nil
}

package handlers

import (
	"bufio"
	"bytes"
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"html/template"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"path"
	"strconv"
	"strings"
	"time"
)

const (
	adminSessionCookie  = "movipilot_session"
	analyticsVisitorKey = "mp_analytics_visitor"
	analyticsSessionKey = "mp_analytics_session"
	analyticsIdleWindow = 30 * time.Minute
	analyticsActiveAge  = 5 * time.Minute
	maxSupportMessage   = 3000
)

// AdminConfig controls the one-time owner bootstrap and analytics timezone.
// MOVIPILOT_ADMIN_EMAIL must match an existing MoviPilot account.
type AdminConfig struct {
	AdminEmail    string
	Timezone      string
	SecureCookies bool
}

// AdminConfigFromEnv reads admin settings without adding another config file.
func AdminConfigFromEnv() AdminConfig {
	return AdminConfig{
		AdminEmail:    strings.ToLower(strings.TrimSpace(os.Getenv("MOVIPILOT_ADMIN_EMAIL"))),
		Timezone:      strings.TrimSpace(os.Getenv("ANALYTICS_TIMEZONE")),
		SecureCookies: adminSecureCookieEnabled(),
	}
}

// adminSecureCookieEnabled must also be used by the existing login and OAuth
// cookie helpers. Checking r.TLS alone is incorrect behind a TLS reverse proxy.
func adminSecureCookieEnabled() bool {
	return strings.EqualFold(strings.TrimSpace(os.Getenv("MOVIPILOT_SECURE_COOKIES")), "true")
}

type adminHandler struct {
	db            *sql.DB
	location      *time.Location
	secureCookies bool
	configured    bool
	template      *template.Template
}

type adminIdentity struct {
	UserID int64
}

type adminContextKey struct{}

type adminOverview struct {
	GeneratedAt time.Time         `json:"generatedAt"`
	Range       string            `json:"range"`
	Summary     adminSummary      `json:"summary"`
	Chart       []adminChartPoint `json:"chart"`
	TopPages    []adminTopPage    `json:"topPages"`
	RecentUsers []adminRecentUser `json:"recentUsers"`
}

type adminSummary struct {
	TotalUsers        int64 `json:"totalUsers"`
	NewToday          int64 `json:"newToday"`
	NewThisWeek       int64 `json:"newThisWeek"`
	NewThisMonth      int64 `json:"newThisMonth"`
	UniqueVisitors    int64 `json:"uniqueVisitors"`
	NewVisitors       int64 `json:"newVisitors"`
	ReturningVisitors int64 `json:"returningVisitors"`
	PageViews         int64 `json:"pageViews"`
	Sessions          int64 `json:"sessions"`
	ActiveVisitors    int64 `json:"activeVisitors"`
}

type adminChartPoint struct {
	Date      string `json:"date"`
	Label     string `json:"label"`
	Signups   int64  `json:"signups"`
	Visitors  int64  `json:"visitors"`
	PageViews int64  `json:"pageViews"`
}

type adminTopPage struct {
	Path     string `json:"path"`
	Views    int64  `json:"views"`
	Visitors int64  `json:"visitors"`
}

type adminRecentUser struct {
	ID           int64  `json:"id"`
	FullName     string `json:"fullName"`
	MaskedEmail  string `json:"maskedEmail"`
	AuthProvider string `json:"authProvider"`
	CreatedAt    string `json:"createdAt"`
}

type adminUserRow struct {
	ID           int64  `json:"id"`
	FullName     string `json:"fullName"`
	Email        string `json:"email"`
	AuthProvider string `json:"authProvider"`
	CreatedAt    string `json:"createdAt"`
}

type adminErrorRow struct {
	ID         int64  `json:"id"`
	OccurredAt int64  `json:"occurredAt"`
	Method     string `json:"method"`
	Route      string `json:"route"`
	Status     int    `json:"status"`
	Message    string `json:"message"`
	RequestID  string `json:"requestId"`
}

type adminActivityEvent struct {
	ID         string `json:"id"`
	Kind       string `json:"kind"`
	Title      string `json:"title"`
	Detail     string `json:"detail"`
	OccurredAt int64  `json:"occurredAt"`
}

type adminSupportMessage struct {
	ID         int64  `json:"id"`
	SenderRole string `json:"senderRole"`
	SenderName string `json:"senderName"`
	Body       string `json:"body"`
	CreatedAt  int64  `json:"createdAt"`
}

type adminSupportConversation struct {
	ID            int64                 `json:"id"`
	UserName      string                `json:"userName,omitempty"`
	Status        string                `json:"status"`
	UpdatedAt     int64                 `json:"updatedAt"`
	LastMessage   string                `json:"lastMessage,omitempty"`
	LastMessageID int64                 `json:"lastMessageId,omitempty"`
	Unread        bool                  `json:"unread,omitempty"`
	Messages      []adminSupportMessage `json:"messages,omitempty"`
}

// RegisterAdminRoutes creates the admin, analytics, and support endpoints.
// Call it after storage.InitDatabase() has completed and before ListenAndServe.
// The provided DB is the existing storage.DB pool; no second database is opened.
func RegisterAdminRoutes(mux *http.ServeMux, db *sql.DB, cfg AdminConfig) error {
	if mux == nil || db == nil {
		return errors.New("admin routes require a mux and an initialized database")
	}

	if err := ensureMoviPilotAdminSchema(db); err != nil {
		return fmt.Errorf("initialize admin schema: %w", err)
	}

	location := time.Local
	if cfg.Timezone != "" {
		loaded, err := time.LoadLocation(cfg.Timezone)
		if err != nil {
			return fmt.Errorf("invalid ANALYTICS_TIMEZONE %q: %w", cfg.Timezone, err)
		}
		location = loaded
	} else if loaded, err := time.LoadLocation("Africa/Lagos"); err == nil {
		location = loaded
	}

	h := &adminHandler{
		db:            db,
		location:      location,
		secureCookies: cfg.SecureCookies,
		configured:    strings.TrimSpace(cfg.AdminEmail) != "",
	}

	if h.configured {
		if err := h.bootstrapOwner(cfg.AdminEmail); err != nil {
			return fmt.Errorf("bootstrap MoviPilot admin: %w", err)
		}
	}

	// This template deliberately lives outside /templates/, which is exposed
	// by the existing public static-file handler in main.go.
	tmpl, err := template.ParseFiles("views/admin_dashboard.html")
	if err != nil {
		return fmt.Errorf("parse private admin template: %w", err)
	}
	h.template = tmpl

	mux.HandleFunc("/admin", h.adminPage)
	mux.HandleFunc("/api/admin/overview", h.requireAdmin(h.adminOverview))
	mux.HandleFunc("/api/admin/users", h.requireAdmin(h.adminUsers))
	mux.HandleFunc("/api/admin/errors", h.requireAdmin(h.adminErrors))
	mux.HandleFunc("/api/admin/activity", h.requireAdmin(h.adminActivity))
	mux.HandleFunc("/api/admin/health", h.requireAdmin(h.adminHealth))
	mux.HandleFunc("/api/admin/support", h.requireAdmin(h.adminSupportList))
	mux.HandleFunc("/api/admin/support/messages", h.requireAdmin(h.adminSupportMessages))
	mux.HandleFunc("/api/admin/support/reply", h.requireAdmin(h.adminSupportReply))
	mux.HandleFunc("/api/admin/support/resolve", h.requireAdmin(h.adminSupportResolve))
	mux.HandleFunc("/api/analytics/track", h.trackAnalytics)
	mux.HandleFunc("/api/community/support", h.requireUser(h.communitySupport))
	mux.HandleFunc("/api/community/support/status", h.requireUser(h.communitySupportStatus))
	mux.HandleFunc("/api/community/support/read", h.requireUser(h.communitySupportRead))
	return nil
}

func ensureMoviPilotAdminSchema(db *sql.DB) error {
	statements := []string{
		`CREATE TABLE IF NOT EXISTS mp_admin_users (
			user_id INTEGER PRIMARY KEY,
			email TEXT NOT NULL,
			role TEXT NOT NULL DEFAULT 'owner',
			is_active INTEGER NOT NULL DEFAULT 1,
			created_at INTEGER NOT NULL,
			FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
		)`,
		`CREATE TABLE IF NOT EXISTS mp_analytics_visitors (
			visitor_id TEXT PRIMARY KEY,
			first_seen INTEGER NOT NULL,
			last_seen INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS mp_analytics_sessions (
			session_id TEXT PRIMARY KEY,
			visitor_id TEXT NOT NULL,
			started_at INTEGER NOT NULL,
			last_seen INTEGER NOT NULL,
			page_views INTEGER NOT NULL DEFAULT 0,
			FOREIGN KEY(visitor_id) REFERENCES mp_analytics_visitors(visitor_id) ON DELETE CASCADE
		)`,
		`CREATE TABLE IF NOT EXISTS mp_analytics_page_views (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			visitor_id TEXT NOT NULL,
			session_id TEXT NOT NULL,
			page TEXT NOT NULL,
			viewed_at INTEGER NOT NULL,
			FOREIGN KEY(visitor_id) REFERENCES mp_analytics_visitors(visitor_id) ON DELETE CASCADE,
			FOREIGN KEY(session_id) REFERENCES mp_analytics_sessions(session_id) ON DELETE CASCADE
		)`,
		`CREATE TABLE IF NOT EXISTS mp_application_errors (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			occurred_at INTEGER NOT NULL,
			method TEXT NOT NULL,
			route TEXT NOT NULL,
			status INTEGER NOT NULL,
			message TEXT NOT NULL,
			request_id TEXT NOT NULL DEFAULT ''
		)`,
		`CREATE TABLE IF NOT EXISTS mp_support_conversations (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL UNIQUE,
			status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','waiting','resolved')),
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL,
			FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
		)`,
		`CREATE TABLE IF NOT EXISTS mp_support_messages (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			conversation_id INTEGER NOT NULL,
			sender_user_id INTEGER NOT NULL,
			sender_role TEXT NOT NULL CHECK(sender_role IN ('user','admin')),
			body TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			read_at INTEGER,
			FOREIGN KEY(conversation_id) REFERENCES mp_support_conversations(id) ON DELETE CASCADE,
			FOREIGN KEY(sender_user_id) REFERENCES users(id) ON DELETE CASCADE
		)`,
		`CREATE INDEX IF NOT EXISTS idx_mp_analytics_visitors_last_seen ON mp_analytics_visitors(last_seen)`,
		`CREATE INDEX IF NOT EXISTS idx_mp_analytics_sessions_started ON mp_analytics_sessions(started_at)`,
		`CREATE INDEX IF NOT EXISTS idx_mp_analytics_page_views_time ON mp_analytics_page_views(viewed_at)`,
		`CREATE INDEX IF NOT EXISTS idx_mp_analytics_page_views_page ON mp_analytics_page_views(page, viewed_at)`,
		`CREATE INDEX IF NOT EXISTS idx_mp_application_errors_time ON mp_application_errors(occurred_at)`,
		`CREATE INDEX IF NOT EXISTS idx_mp_support_conversations_status ON mp_support_conversations(status, updated_at)`,
		`CREATE INDEX IF NOT EXISTS idx_mp_support_messages_conversation ON mp_support_messages(conversation_id, id)`,
		`CREATE INDEX IF NOT EXISTS idx_mp_support_messages_unread ON mp_support_messages(sender_role, read_at)`,
	}
	for _, statement := range statements {
		if _, err := db.Exec(statement); err != nil {
			return err
		}
	}
	return nil
}

func (h *adminHandler) bootstrapOwner(email string) error {
	email = strings.ToLower(strings.TrimSpace(email))
	if email == "" || len(email) > 254 || !strings.Contains(email, "@") {
		return errors.New("MOVIPILOT_ADMIN_EMAIL must be a valid email for an existing account")
	}
	var userID int64
	if err := h.db.QueryRow(`SELECT id FROM users WHERE lower(email) = ? LIMIT 1`, email).Scan(&userID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return fmt.Errorf("no MoviPilot account exists for MOVIPILOT_ADMIN_EMAIL %q; create the account first", email)
		}
		return err
	}
	// There is one environment-configured owner. If the deployment owner
	// changes, disable the previous owner instead of silently retaining access.
	if _, err := h.db.Exec(`UPDATE mp_admin_users SET is_active = 0 WHERE role = 'owner' AND user_id <> ?`, userID); err != nil {
		return err
	}
	if _, err := h.db.Exec(`INSERT OR IGNORE INTO mp_admin_users(user_id, email, role, is_active, created_at) VALUES(?, ?, 'owner', 1, ?)`, userID, email, time.Now().Unix()); err != nil {
		return err
	}
	// Keep the admin record's reference email in step with the configured
	// account, but do not reactivate an owner that was intentionally disabled.
	_, err := h.db.Exec(`UPDATE mp_admin_users SET email = ? WHERE user_id = ? AND role = 'owner' AND is_active = 1`, email, userID)
	return err
}

func (h *adminHandler) adminPage(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/admin" {
		http.NotFound(w, r)
		return
	}
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !h.configured {
		http.NotFound(w, r)
		return
	}
	if _, ok := h.authenticateAdmin(r); !ok {
		http.Redirect(w, r, "/login", http.StatusSeeOther)
		return
	}
	setAdminPrivateHeaders(w)
	w.Header().Set("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'")
	var buf bytes.Buffer
	if err := h.template.ExecuteTemplate(&buf, "admin_dashboard.html", nil); err != nil {
		log.Printf("admin template execution failed: %v", err)
		http.Error(w, "The admin dashboard could not be loaded.", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write(buf.Bytes())
}

func setAdminPrivateHeaders(w http.ResponseWriter) {
	w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate, private")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "same-origin")
	w.Header().Set("X-Frame-Options", "DENY")
}

func (h *adminHandler) requireAdmin(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		setAdminPrivateHeaders(w)
		if !h.configured {
			adminWriteJSON(w, http.StatusNotFound, map[string]string{"error": "Not found"})
			return
		}
		identity, ok := h.authenticateAdmin(r)
		if !ok {
			adminWriteJSON(w, http.StatusUnauthorized, map[string]string{"error": "Please sign in with an authorized admin account."})
			return
		}
		next(w, r.WithContext(context.WithValue(r.Context(), adminContextKey{}, identity)))
	}
}

func (h *adminHandler) requireUser(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		setAdminPrivateHeaders(w)
		if _, ok := h.authenticateUser(r); !ok {
			adminWriteJSON(w, http.StatusUnauthorized, map[string]string{"error": "Please sign in to contact MoviPilot support."})
			return
		}
		next(w, r)
	}
}

func (h *adminHandler) authenticateUser(r *http.Request) (int64, bool) {
	cookie, err := r.Cookie(adminSessionCookie)
	if err != nil || len(cookie.Value) != 64 {
		return 0, false
	}
	if _, err := hex.DecodeString(cookie.Value); err != nil {
		return 0, false
	}
	var userID int64
	err = h.db.QueryRowContext(r.Context(), `
		SELECT s.user_id
		FROM sessions s
		JOIN users u ON u.id = s.user_id
		WHERE s.id = ? AND s.expires_at > ?
		LIMIT 1`, cookie.Value, time.Now().Unix()).Scan(&userID)
	return userID, err == nil && userID > 0
}

func (h *adminHandler) authenticateAdmin(r *http.Request) (adminIdentity, bool) {
	userID, ok := h.authenticateUser(r)
	if !ok {
		return adminIdentity{}, false
	}
	var active int
	err := h.db.QueryRowContext(r.Context(), `SELECT is_active FROM mp_admin_users WHERE user_id = ? AND role IN ('owner','admin') LIMIT 1`, userID).Scan(&active)
	if err != nil || active != 1 {
		return adminIdentity{}, false
	}
	return adminIdentity{UserID: userID}, true
}

func adminIDFromContext(r *http.Request) int64 {
	identity, _ := r.Context().Value(adminContextKey{}).(adminIdentity)
	return identity.UserID
}

func (h *adminHandler) adminOverview(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		adminMethodNotAllowed(w, http.MethodGet)
		return
	}
	rangeName := r.URL.Query().Get("range")
	days := 30
	switch rangeName {
	case "7d":
		days = 7
	case "30d", "":
		rangeName = "30d"
	case "90d":
		days = 90
	default:
		adminWriteJSON(w, http.StatusBadRequest, map[string]string{"error": "Unsupported analytics range"})
		return
	}
	if rangeName == "" {
		rangeName = "30d"
	}
	now := time.Now().In(h.location)
	localToday := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, h.location)
	start := localToday.AddDate(0, 0, -(days - 1))
	end := localToday.AddDate(0, 0, 1)
	weekStart := adminMondayStart(localToday)
	monthStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, h.location)

	var data adminOverview
	data.GeneratedAt = now
	data.Range = rangeName

	queries := []struct {
		dest  *int64
		query string
		args  []any
	}{
		{&data.Summary.TotalUsers, `SELECT COUNT(*) FROM users`, nil},
		{&data.Summary.NewToday, `SELECT COUNT(*) FROM users WHERE datetime(created_at) >= datetime(?, 'unixepoch') AND datetime(created_at) < datetime(?, 'unixepoch')`, []any{localToday.Unix(), end.Unix()}},
		{&data.Summary.NewThisWeek, `SELECT COUNT(*) FROM users WHERE datetime(created_at) >= datetime(?, 'unixepoch') AND datetime(created_at) < datetime(?, 'unixepoch')`, []any{weekStart.Unix(), end.Unix()}},
		{&data.Summary.NewThisMonth, `SELECT COUNT(*) FROM users WHERE datetime(created_at) >= datetime(?, 'unixepoch') AND datetime(created_at) < datetime(?, 'unixepoch')`, []any{monthStart.Unix(), end.Unix()}},
		{&data.Summary.PageViews, `SELECT COUNT(*) FROM mp_analytics_page_views WHERE viewed_at >= ? AND viewed_at < ?`, []any{start.Unix(), end.Unix()}},
		{&data.Summary.UniqueVisitors, `SELECT COUNT(DISTINCT visitor_id) FROM mp_analytics_page_views WHERE viewed_at >= ? AND viewed_at < ?`, []any{start.Unix(), end.Unix()}},
		{&data.Summary.Sessions, `SELECT COUNT(*) FROM mp_analytics_sessions WHERE started_at >= ? AND started_at < ?`, []any{start.Unix(), end.Unix()}},
		{&data.Summary.ActiveVisitors, `SELECT COUNT(*) FROM mp_analytics_visitors WHERE last_seen >= ?`, []any{now.Add(-analyticsActiveAge).Unix()}},
	}
	for _, item := range queries {
		if err := h.db.QueryRowContext(r.Context(), item.query, item.args...).Scan(item.dest); err != nil {
			adminWriteJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Analytics data is temporarily unavailable."})
			return
		}
	}
	if err := h.db.QueryRowContext(r.Context(), `
		SELECT COUNT(DISTINCT p.visitor_id)
		FROM mp_analytics_page_views p
		JOIN mp_analytics_visitors v ON v.visitor_id = p.visitor_id
		WHERE p.viewed_at >= ? AND p.viewed_at < ? AND v.first_seen >= ?`,
		start.Unix(), end.Unix(), start.Unix()).Scan(&data.Summary.NewVisitors); err != nil {
		adminWriteJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Visitor analytics are temporarily unavailable."})
		return
	}
	if err := h.db.QueryRowContext(r.Context(), `
		SELECT COUNT(DISTINCT p.visitor_id)
		FROM mp_analytics_page_views p
		JOIN mp_analytics_visitors v ON v.visitor_id = p.visitor_id
		WHERE p.viewed_at >= ? AND p.viewed_at < ? AND v.first_seen < ?`,
		start.Unix(), end.Unix(), start.Unix()).Scan(&data.Summary.ReturningVisitors); err != nil {
		adminWriteJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Visitor analytics are temporarily unavailable."})
		return
	}

	data.Chart = make([]adminChartPoint, 0, days)
	pointByDate := make(map[string]*adminChartPoint, days)
	for i := 0; i < days; i++ {
		day := start.AddDate(0, 0, i)
		key := day.Format("2006-01-02")
		point := &adminChartPoint{Date: key, Label: day.Format("Jan 2")}
		pointByDate[key] = point
		data.Chart = append(data.Chart, *point)
	}
	_, offset := start.In(h.location).Zone()
	pageRows, err := h.db.QueryContext(r.Context(), `
		SELECT date(viewed_at + ?, 'unixepoch') AS day,
		       COUNT(*) AS views,
		       COUNT(DISTINCT visitor_id) AS visitors
		FROM mp_analytics_page_views
		WHERE viewed_at >= ? AND viewed_at < ?
		GROUP BY day`, offset, start.Unix(), end.Unix())
	if err != nil {
		adminWriteJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Traffic chart is temporarily unavailable."})
		return
	}
	for pageRows.Next() {
		var day string
		var views, visitors int64
		if err := pageRows.Scan(&day, &views, &visitors); err != nil {
			pageRows.Close()
			adminWriteJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Traffic chart is temporarily unavailable."})
			return
		}
		if point := pointByDate[day]; point != nil {
			point.PageViews = views
			point.Visitors = visitors
		}
	}
	if err := pageRows.Err(); err != nil {
		pageRows.Close()
		adminWriteJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Traffic chart is temporarily unavailable."})
		return
	}
	pageRows.Close()

	userRows, err := h.db.QueryContext(r.Context(), `
		SELECT date(CAST(strftime('%s', created_at) AS INTEGER) + ?, 'unixepoch') AS day, COUNT(*)
		FROM users
		WHERE datetime(created_at) >= datetime(?, 'unixepoch') AND datetime(created_at) < datetime(?, 'unixepoch')
		GROUP BY day`, offset, start.Unix(), end.Unix())
	if err != nil {
		adminWriteJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Registration chart is temporarily unavailable."})
		return
	}
	for userRows.Next() {
		var day string
		var count int64
		if err := userRows.Scan(&day, &count); err != nil {
			userRows.Close()
			adminWriteJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Registration chart is temporarily unavailable."})
			return
		}
		if point := pointByDate[day]; point != nil {
			point.Signups = count
		}
	}
	if err := userRows.Err(); err != nil {
		userRows.Close()
		adminWriteJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Registration chart is temporarily unavailable."})
		return
	}
	userRows.Close()
	// Copy the final populated values back into the ordered slice.
	for index := range data.Chart {
		if point := pointByDate[data.Chart[index].Date]; point != nil {
			data.Chart[index] = *point
		}
	}

	topRows, err := h.db.QueryContext(r.Context(), `
		SELECT page, COUNT(*) AS views, COUNT(DISTINCT visitor_id) AS visitors
		FROM mp_analytics_page_views
		WHERE viewed_at >= ? AND viewed_at < ?
		GROUP BY page ORDER BY views DESC LIMIT 8`, start.Unix(), end.Unix())
	if err == nil {
		defer topRows.Close()
		for topRows.Next() {
			var row adminTopPage
			if topRows.Scan(&row.Path, &row.Views, &row.Visitors) == nil {
				data.TopPages = append(data.TopPages, row)
			}
		}
	}

	recentRows, err := h.db.QueryContext(r.Context(), `
		SELECT id, full_name, email, auth_provider, created_at
		FROM users ORDER BY datetime(created_at) DESC LIMIT 8`)
	if err == nil {
		defer recentRows.Close()
		for recentRows.Next() {
			var row adminRecentUser
			var email string
			if recentRows.Scan(&row.ID, &row.FullName, &email, &row.AuthProvider, &row.CreatedAt) == nil {
				row.MaskedEmail = adminMaskEmail(email)
				data.RecentUsers = append(data.RecentUsers, row)
			}
		}
	}
	adminWriteJSON(w, http.StatusOK, data)
}

func adminMondayStart(day time.Time) time.Time {
	weekday := (int(day.Weekday()) + 6) % 7
	return day.AddDate(0, 0, -weekday)
}

func adminMaskEmail(email string) string {
	parts := strings.SplitN(strings.TrimSpace(email), "@", 2)
	if len(parts) != 2 || parts[0] == "" {
		return "hidden"
	}
	first := parts[0][:1]
	return first + "•••@" + parts[1]
}

func (h *adminHandler) adminUsers(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		adminMethodNotAllowed(w, http.MethodGet)
		return
	}
	limit := 50
	if value := r.URL.Query().Get("limit"); value != "" {
		parsed, err := strconv.Atoi(value)
		if err != nil || parsed < 1 || parsed > 100 {
			adminWriteJSON(w, http.StatusBadRequest, map[string]string{"error": "Limit must be between 1 and 100."})
			return
		}
		limit = parsed
	}
	rows, err := h.db.QueryContext(r.Context(), `SELECT id, full_name, email, auth_provider, created_at FROM users ORDER BY datetime(created_at) DESC LIMIT ?`, limit)
	if err != nil {
		adminWriteJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "User records are temporarily unavailable."})
		return
	}
	defer rows.Close()
	users := make([]adminUserRow, 0, limit)
	for rows.Next() {
		var user adminUserRow
		if err := rows.Scan(&user.ID, &user.FullName, &user.Email, &user.AuthProvider, &user.CreatedAt); err != nil {
			adminWriteJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "User records are temporarily unavailable."})
			return
		}
		users = append(users, user)
	}
	if err := rows.Err(); err != nil {
		adminWriteJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "User records are temporarily unavailable."})
		return
	}
	adminWriteJSON(w, http.StatusOK, map[string]any{"users": users})
}

func (h *adminHandler) adminErrors(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		adminMethodNotAllowed(w, http.MethodGet)
		return
	}
	rows, err := h.db.QueryContext(r.Context(), `SELECT id, occurred_at, method, route, status, message, request_id FROM mp_application_errors ORDER BY occurred_at DESC LIMIT 50`)
	if err != nil {
		adminWriteJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Application error records are unavailable."})
		return
	}
	defer rows.Close()
	errorsList := make([]adminErrorRow, 0, 50)
	for rows.Next() {
		var item adminErrorRow
		if err := rows.Scan(&item.ID, &item.OccurredAt, &item.Method, &item.Route, &item.Status, &item.Message, &item.RequestID); err != nil {
			adminWriteJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Application error records are unavailable."})
			return
		}
		errorsList = append(errorsList, item)
	}
	adminWriteJSON(w, http.StatusOK, map[string]any{"errors": errorsList})
}

func (h *adminHandler) adminActivity(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		adminMethodNotAllowed(w, http.MethodGet)
		return
	}
	rows, err := h.db.QueryContext(r.Context(), `
		SELECT event_id, kind, title, detail, occurred_at
		FROM (
			SELECT 'signup-' || id AS event_id, 'signup' AS kind, full_name AS title,
			       'Registered a MoviPilot account' AS detail,
			       CAST(strftime('%s', created_at) AS INTEGER) AS occurred_at
			FROM users
			UNION ALL
			SELECT 'support-' || m.id AS event_id, 'support' AS kind, u.full_name AS title,
			       CASE WHEN m.sender_role = 'admin' THEN 'MoviPilot Support sent a reply' ELSE 'Sent a message to MoviPilot Support' END AS detail,
			       m.created_at AS occurred_at
			FROM mp_support_messages m
			JOIN mp_support_conversations c ON c.id = m.conversation_id
			JOIN users u ON u.id = c.user_id
			UNION ALL
			SELECT 'error-' || id AS event_id, 'error' AS kind, route AS title,
			       message AS detail, occurred_at
			FROM mp_application_errors
		)
		ORDER BY occurred_at DESC LIMIT 24`)
	if err != nil {
		adminWriteJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Recent platform activity is temporarily unavailable."})
		return
	}
	defer rows.Close()
	events := make([]adminActivityEvent, 0, 24)
	for rows.Next() {
		var item adminActivityEvent
		if err := rows.Scan(&item.ID, &item.Kind, &item.Title, &item.Detail, &item.OccurredAt); err != nil {
			adminWriteJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Recent platform activity is temporarily unavailable."})
			return
		}
		events = append(events, item)
	}
	if err := rows.Err(); err != nil {
		adminWriteJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Recent platform activity is temporarily unavailable."})
		return
	}
	adminWriteJSON(w, http.StatusOK, map[string]any{"activity": events})
}

func (h *adminHandler) adminHealth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		adminMethodNotAllowed(w, http.MethodGet)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	dbStatus := "online"
	if err := h.db.PingContext(ctx); err != nil {
		dbStatus = "degraded"
	}
	var errors24h int64
	_ = h.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM mp_application_errors WHERE occurred_at >= ?`, time.Now().Add(-24*time.Hour).Unix()).Scan(&errors24h)
	adminWriteJSON(w, http.StatusOK, map[string]any{
		"checkedAt": time.Now().UTC(),
		"services": []map[string]string{
			{"name": "MoviPilot application", "status": "online", "detail": "Admin handler responded successfully."},
			{"name": "SQLite database", "status": dbStatus, "detail": "Database connectivity check."},
			{"name": "Analytics pipeline", "status": dbStatus, "detail": "Analytics tables are stored in the application database."},
		},
		"errorsLast24Hours": errors24h,
	})
}

// trackAnalytics accepts only same-origin page_view and heartbeat events.
// The visitor and analytics-session identifiers are random pseudonymous tokens.
func (h *adminHandler) trackAnalytics(w http.ResponseWriter, r *http.Request) {
	setAdminPrivateHeaders(w)
	if r.Method != http.MethodPost {
		adminMethodNotAllowed(w, http.MethodPost)
		return
	}
	if !adminSameOriginRequest(r) {
		adminWriteJSON(w, http.StatusForbidden, map[string]string{"error": "Origin check failed."})
		return
	}
	if h.isAdminRequest(r) || isLikelyAnalyticsBot(r.UserAgent()) {
		adminWriteJSON(w, http.StatusOK, map[string]bool{"ok": true, "ignored": true})
		return
	}
	var payload struct {
		Event string `json:"event"`
		Path  string `json:"path"`
	}
	if err := adminDecodeJSONBody(w, r, 2048, &payload); err != nil {
		adminWriteJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid analytics event."})
		return
	}
	if payload.Event != "page_view" && payload.Event != "heartbeat" {
		adminWriteJSON(w, http.StatusBadRequest, map[string]string{"error": "Unsupported analytics event."})
		return
	}
	page := ""
	if payload.Event == "page_view" {
		page = adminNormalizeAnalyticsPath(payload.Path)
		if page == "" {
			adminWriteJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid page path."})
			return
		}
	}
	if err := h.saveAnalyticsEvent(w, r, payload.Event, page); err != nil {
		log.Printf("analytics event could not be stored: %v", err)
		adminWriteJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Analytics is temporarily unavailable."})
		return
	}
	adminWriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *adminHandler) isAdminRequest(r *http.Request) bool {
	_, ok := h.authenticateAdmin(r)
	return ok
}

func (h *adminHandler) saveAnalyticsEvent(w http.ResponseWriter, r *http.Request, event, page string) error {
	now := time.Now().Unix()
	visitorID := validAnalyticsCookie(r, analyticsVisitorKey)
	if visitorID == "" {
		visitorID = adminRandomHexToken(32)
	}
	if visitorID == "" {
		return errors.New("secure visitor token generation failed")
	}
	sessionID := validAnalyticsCookie(r, analyticsSessionKey)

	tx, err := h.db.BeginTx(r.Context(), nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(r.Context(), `
		INSERT INTO mp_analytics_visitors(visitor_id, first_seen, last_seen)
		VALUES(?, ?, ?)
		ON CONFLICT(visitor_id) DO UPDATE SET last_seen = excluded.last_seen`, visitorID, now, now); err != nil {
		return err
	}

	var storedVisitor string
	var lastSeen int64
	if sessionID != "" {
		err := tx.QueryRowContext(r.Context(), `SELECT visitor_id, last_seen FROM mp_analytics_sessions WHERE session_id = ?`, sessionID).Scan(&storedVisitor, &lastSeen)
		if err != nil || storedVisitor != visitorID || now-lastSeen > int64(analyticsIdleWindow.Seconds()) {
			sessionID = ""
		}
	}
	if sessionID == "" {
		sessionID = adminRandomHexToken(32)
		if sessionID == "" {
			return errors.New("secure analytics session token generation failed")
		}
		if _, err := tx.ExecContext(r.Context(), `INSERT INTO mp_analytics_sessions(session_id, visitor_id, started_at, last_seen, page_views) VALUES(?, ?, ?, ?, 0)`, sessionID, visitorID, now, now); err != nil {
			return err
		}
	} else if _, err := tx.ExecContext(r.Context(), `UPDATE mp_analytics_sessions SET last_seen = ? WHERE session_id = ?`, now, sessionID); err != nil {
		return err
	}
	if event == "page_view" {
		if _, err := tx.ExecContext(r.Context(), `INSERT INTO mp_analytics_page_views(visitor_id, session_id, page, viewed_at) VALUES(?, ?, ?, ?)`, visitorID, sessionID, page, now); err != nil {
			return err
		}
		if _, err := tx.ExecContext(r.Context(), `UPDATE mp_analytics_sessions SET page_views = page_views + 1 WHERE session_id = ?`, sessionID); err != nil {
			return err
		}
	}
	if err := tx.Commit(); err != nil {
		return err
	}

	http.SetCookie(w, &http.Cookie{Name: analyticsVisitorKey, Value: visitorID, Path: "/", MaxAge: 31536000, HttpOnly: true, Secure: h.secureCookies, SameSite: http.SameSiteLaxMode})
	http.SetCookie(w, &http.Cookie{Name: analyticsSessionKey, Value: sessionID, Path: "/", MaxAge: int(analyticsIdleWindow.Seconds()), HttpOnly: true, Secure: h.secureCookies, SameSite: http.SameSiteLaxMode})
	return nil
}

func isLikelyAnalyticsBot(userAgent string) bool {
	value := strings.ToLower(userAgent)
	for _, marker := range []string{"bot", "crawler", "spider", "slurp", "preview", "facebookexternalhit", "whatsapp"} {
		if strings.Contains(value, marker) {
			return true
		}
	}
	return false
}

func validAnalyticsCookie(r *http.Request, name string) string {
	cookie, err := r.Cookie(name)
	if err != nil || len(cookie.Value) != 64 {
		return ""
	}
	if _, err := hex.DecodeString(cookie.Value); err != nil {
		return ""
	}
	return cookie.Value
}

func adminRandomHexToken(size int) string {
	data := make([]byte, size)
	if _, err := rand.Read(data); err != nil {
		return ""
	}
	return hex.EncodeToString(data)
}

func adminNormalizeAnalyticsPath(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" || len(raw) > 180 || !strings.HasPrefix(raw, "/") || strings.HasPrefix(raw, "//") {
		return ""
	}
	parsed, err := url.ParseRequestURI(raw)
	if err != nil {
		return ""
	}
	cleanPath := path.Clean(parsed.Path)
	if cleanPath == "." || !strings.HasPrefix(cleanPath, "/") || strings.Contains(cleanPath, "\\") {
		return ""
	}
	lower := strings.ToLower(cleanPath)
	for _, excluded := range []string{"/api", "/templates", "/img", "/admin", "/community/chat", "/favicon", "/robots.txt", "/sitemap"} {
		if lower == excluded || strings.HasPrefix(lower, excluded+"/") {
			return ""
		}
	}
	if strings.Contains(path.Base(cleanPath), ".") {
		return ""
	}
	if cleanPath != "/" {
		cleanPath = strings.TrimSuffix(cleanPath, "/")
	}
	if len(cleanPath) > 120 {
		return ""
	}
	return cleanPath
}

func adminSameOriginRequest(r *http.Request) bool {
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin == "" {
		origin = strings.TrimSpace(r.Header.Get("Referer"))
	}
	if origin == "" || r.Host == "" {
		return false
	}
	parsed, err := url.Parse(origin)
	if err != nil || parsed.Host == "" || parsed.User != nil {
		return false
	}
	if !strings.EqualFold(parsed.Host, r.Host) {
		return false
	}
	return parsed.Scheme == "http" || parsed.Scheme == "https"
}

func adminDecodeJSONBody(w http.ResponseWriter, r *http.Request, limit int64, destination any) error {
	mediaType := strings.ToLower(strings.TrimSpace(strings.Split(r.Header.Get("Content-Type"), ";")[0]))
	if mediaType != "application/json" {
		return errors.New("content type must be application/json")
	}
	r.Body = http.MaxBytesReader(w, r.Body, limit)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		return err
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return errors.New("request must contain one JSON object")
	}
	return nil
}

func (h *adminHandler) communitySupport(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		h.getUserSupportConversation(w, r)
	case http.MethodPost:
		if !adminSameOriginRequest(r) {
			adminWriteJSON(w, http.StatusForbidden, map[string]string{"error": "Origin check failed."})
			return
		}
		h.createUserSupportMessage(w, r)
	default:
		adminMethodNotAllowed(w, http.MethodGet+", "+http.MethodPost)
	}
}

func (h *adminHandler) getUserSupportConversation(w http.ResponseWriter, r *http.Request) {
	userID, ok := h.authenticateUser(r)
	if !ok {
		adminWriteJSON(w, http.StatusUnauthorized, map[string]string{"error": "Please sign in again."})
		return
	}
	var conversationID int64
	var status string
	err := h.db.QueryRowContext(r.Context(), `SELECT id, status FROM mp_support_conversations WHERE user_id = ?`, userID).Scan(&conversationID, &status)
	if errors.Is(err, sql.ErrNoRows) {
		adminWriteJSON(w, http.StatusOK, map[string]any{
			"conversation": nil, "unreadCount": 0, "latestAdminMessageId": 0,
		})
		return
	}
	if err != nil {
		adminWriteJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Support messages are temporarily unavailable."})
		return
	}

	// Reading the conversation and acknowledging it are separate operations.
	// This prevents background status polling from silently clearing unread replies.
	var unreadCount, latestAdminMessageID int64
	if err := h.db.QueryRowContext(r.Context(), `
		SELECT COUNT(*), COALESCE(MAX(id), 0)
		FROM mp_support_messages
		WHERE conversation_id = ? AND sender_role = 'admin' AND read_at IS NULL`, conversationID,
	).Scan(&unreadCount, &latestAdminMessageID); err != nil {
		adminWriteJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Support messages are temporarily unavailable."})
		return
	}

	messages, err := h.loadSupportMessages(r.Context(), conversationID, false)
	if err != nil {
		adminWriteJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Support messages are temporarily unavailable."})
		return
	}
	adminWriteJSON(w, http.StatusOK, map[string]any{
		"conversation": adminSupportConversation{ID: conversationID, Status: status, Messages: messages},
		"unreadCount":  unreadCount, "latestAdminMessageId": latestAdminMessageID,
	})
}

// communitySupportStatus is intentionally read-only. The persistent dashboard
// shell polls it on every dashboard page to detect a new reply without opening
// the support conversation or clearing its unread marker.
func (h *adminHandler) communitySupportStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		adminMethodNotAllowed(w, http.MethodGet)
		return
	}
	userID, ok := h.authenticateUser(r)
	if !ok {
		adminWriteJSON(w, http.StatusUnauthorized, map[string]string{"error": "Please sign in again."})
		return
	}
	var conversationID int64
	err := h.db.QueryRowContext(r.Context(), `SELECT id FROM mp_support_conversations WHERE user_id = ?`, userID).Scan(&conversationID)
	if errors.Is(err, sql.ErrNoRows) {
		adminWriteJSON(w, http.StatusOK, map[string]any{"conversationId": 0, "unreadCount": 0, "latestAdminMessageId": 0})
		return
	}
	if err != nil {
		adminWriteJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Support status is temporarily unavailable."})
		return
	}
	var unreadCount, latestAdminMessageID int64
	err = h.db.QueryRowContext(r.Context(), `
		SELECT COUNT(*), COALESCE(MAX(id), 0)
		FROM mp_support_messages
		WHERE conversation_id = ? AND sender_role = 'admin' AND read_at IS NULL`, conversationID,
	).Scan(&unreadCount, &latestAdminMessageID)
	if err != nil {
		adminWriteJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Support status is temporarily unavailable."})
		return
	}
	adminWriteJSON(w, http.StatusOK, map[string]int64{
		"conversationId":       conversationID,
		"unreadCount":          unreadCount,
		"latestAdminMessageId": latestAdminMessageID,
	})
}

// communitySupportRead marks official replies as read only after the support
// section has actually entered the user's viewport (or the user follows its toast).
func (h *adminHandler) communitySupportRead(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		adminMethodNotAllowed(w, http.MethodPost)
		return
	}
	if !adminSameOriginRequest(r) {
		adminWriteJSON(w, http.StatusForbidden, map[string]string{"error": "Origin check failed."})
		return
	}
	userID, ok := h.authenticateUser(r)
	if !ok {
		adminWriteJSON(w, http.StatusUnauthorized, map[string]string{"error": "Please sign in again."})
		return
	}
	now := time.Now().Unix()
	_, err := h.db.ExecContext(r.Context(), `
		UPDATE mp_support_messages
		SET read_at = ?
		WHERE sender_role = 'admin' AND read_at IS NULL
		  AND conversation_id = (SELECT id FROM mp_support_conversations WHERE user_id = ? LIMIT 1)`, now, userID)
	if err != nil {
		adminWriteJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Support messages could not be marked as read."})
		return
	}
	adminWriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *adminHandler) createUserSupportMessage(w http.ResponseWriter, r *http.Request) {
	userID, ok := h.authenticateUser(r)
	if !ok {
		adminWriteJSON(w, http.StatusUnauthorized, map[string]string{"error": "Please sign in again."})
		return
	}
	var payload struct {
		Message string `json:"message"`
	}
	if err := adminDecodeJSONBody(w, r, 16384, &payload); err != nil {
		adminWriteJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid support message."})
		return
	}
	body := strings.TrimSpace(payload.Message)
	if body == "" || len([]rune(body)) > maxSupportMessage {
		adminWriteJSON(w, http.StatusBadRequest, map[string]string{"error": "Write a message of 1 to 3,000 characters."})
		return
	}
	now := time.Now().Unix()
	tx, err := h.db.BeginTx(r.Context(), nil)
	if err != nil {
		adminWriteJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Your support message could not be saved."})
		return
	}
	defer tx.Rollback()
	var recentMessages int
	if err := tx.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM mp_support_messages WHERE sender_user_id = ? AND sender_role = 'user' AND created_at >= ?`, userID, now-60).Scan(&recentMessages); err != nil {
		adminWriteJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Your support message could not be saved."})
		return
	}
	if recentMessages >= 6 {
		adminWriteJSON(w, http.StatusTooManyRequests, map[string]string{"error": "You have sent several messages recently. Please wait a moment and try again."})
		return
	}
	if _, err := tx.ExecContext(r.Context(), `
		INSERT INTO mp_support_conversations(user_id, status, created_at, updated_at)
		VALUES(?, 'open', ?, ?)
		ON CONFLICT(user_id) DO UPDATE SET status = 'open', updated_at = excluded.updated_at`, userID, now, now); err != nil {
		adminWriteJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Your support message could not be saved."})
		return
	}
	var conversationID int64
	if err := tx.QueryRowContext(r.Context(), `SELECT id FROM mp_support_conversations WHERE user_id = ?`, userID).Scan(&conversationID); err != nil {
		adminWriteJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Your support message could not be saved."})
		return
	}
	if _, err := tx.ExecContext(r.Context(), `INSERT INTO mp_support_messages(conversation_id, sender_user_id, sender_role, body, created_at) VALUES(?, ?, 'user', ?, ?)`, conversationID, userID, body, now); err != nil {
		adminWriteJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Your support message could not be saved."})
		return
	}
	if err := tx.Commit(); err != nil {
		adminWriteJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Your support message could not be saved."})
		return
	}
	adminWriteJSON(w, http.StatusCreated, map[string]bool{"ok": true})
}

func (h *adminHandler) adminSupportList(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		adminMethodNotAllowed(w, http.MethodGet)
		return
	}
	rows, err := h.db.QueryContext(r.Context(), `
		SELECT c.id, u.full_name, c.status, c.updated_at,
		       COALESCE((SELECT body FROM mp_support_messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1), ''),
		       COALESCE((SELECT id FROM mp_support_messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1), 0),
		       EXISTS(SELECT 1 FROM mp_support_messages m WHERE m.conversation_id = c.id AND m.sender_role = 'user' AND m.read_at IS NULL)
		FROM mp_support_conversations c
		JOIN users u ON u.id = c.user_id
		WHERE c.status <> 'resolved'
		ORDER BY c.updated_at DESC LIMIT 100`)
	if err != nil {
		adminWriteJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "The support inbox is temporarily unavailable."})
		return
	}
	defer rows.Close()
	items := make([]adminSupportConversation, 0, 30)
	for rows.Next() {
		var item adminSupportConversation
		var unread int
		if err := rows.Scan(&item.ID, &item.UserName, &item.Status, &item.UpdatedAt, &item.LastMessage, &item.LastMessageID, &unread); err != nil {
			adminWriteJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "The support inbox is temporarily unavailable."})
			return
		}
		item.Unread = unread == 1
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		adminWriteJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "The support inbox is temporarily unavailable."})
		return
	}
	if err := rows.Close(); err != nil {
		adminWriteJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "The support inbox is temporarily unavailable."})
		return
	}

	var unreadCount, latestUnreadMessageID, latestUnreadConversationID int64
	err = h.db.QueryRowContext(r.Context(), `
		SELECT COUNT(DISTINCT conversation_id), COALESCE(MAX(id), 0)
		FROM mp_support_messages
		WHERE sender_role = 'user' AND read_at IS NULL`).Scan(&unreadCount, &latestUnreadMessageID)
	if err != nil {
		adminWriteJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "The support inbox is temporarily unavailable."})
		return
	}
	if latestUnreadMessageID > 0 {
		err = h.db.QueryRowContext(r.Context(), `SELECT conversation_id FROM mp_support_messages WHERE id = ?`, latestUnreadMessageID).Scan(&latestUnreadConversationID)
		if err != nil {
			adminWriteJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "The support inbox is temporarily unavailable."})
			return
		}
	}
	adminWriteJSON(w, http.StatusOK, map[string]any{
		"conversations":              items,
		"unreadCount":                unreadCount,
		"latestUnreadMessageId":      latestUnreadMessageID,
		"latestUnreadConversationId": latestUnreadConversationID,
	})
}

func (h *adminHandler) adminSupportMessages(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		adminMethodNotAllowed(w, http.MethodGet)
		return
	}
	conversationID, err := strconv.ParseInt(r.URL.Query().Get("conversation_id"), 10, 64)
	if err != nil || conversationID <= 0 {
		adminWriteJSON(w, http.StatusBadRequest, map[string]string{"error": "A valid conversation ID is required."})
		return
	}
	_, _ = h.db.ExecContext(r.Context(), `UPDATE mp_support_messages SET read_at = ? WHERE conversation_id = ? AND sender_role = 'user' AND read_at IS NULL`, time.Now().Unix(), conversationID)
	messages, err := h.loadSupportMessages(r.Context(), conversationID, true)
	if err != nil {
		adminWriteJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "The support conversation is unavailable."})
		return
	}
	adminWriteJSON(w, http.StatusOK, map[string]any{"messages": messages})
}

func (h *adminHandler) loadSupportMessages(ctx context.Context, conversationID int64, adminView bool) ([]adminSupportMessage, error) {
	rows, err := h.db.QueryContext(ctx, `
		SELECT id, sender_role, body, created_at
		FROM (SELECT id, sender_role, body, created_at FROM mp_support_messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 100)
		ORDER BY id ASC`, conversationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	messages := make([]adminSupportMessage, 0, 30)
	for rows.Next() {
		var item adminSupportMessage
		if err := rows.Scan(&item.ID, &item.SenderRole, &item.Body, &item.CreatedAt); err != nil {
			return nil, err
		}
		if item.SenderRole == "admin" {
			item.SenderName = "MoviPilot Support Team"
		} else {
			item.SenderName = "You"
			if adminView {
				item.SenderName = "Member"
			}
		}
		messages = append(messages, item)
	}
	return messages, rows.Err()
}

func (h *adminHandler) adminSupportReply(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		adminMethodNotAllowed(w, http.MethodPost)
		return
	}
	if !adminSameOriginRequest(r) {
		adminWriteJSON(w, http.StatusForbidden, map[string]string{"error": "Origin check failed."})
		return
	}
	var payload struct {
		ConversationID int64  `json:"conversationId"`
		Message        string `json:"message"`
	}
	if err := adminDecodeJSONBody(w, r, 16384, &payload); err != nil {
		adminWriteJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid reply."})
		return
	}
	body := strings.TrimSpace(payload.Message)
	if payload.ConversationID <= 0 || body == "" || len([]rune(body)) > maxSupportMessage {
		adminWriteJSON(w, http.StatusBadRequest, map[string]string{"error": "Choose a conversation and write a reply of 1 to 3,000 characters."})
		return
	}
	adminID := adminIDFromContext(r)
	now := time.Now().Unix()
	tx, err := h.db.BeginTx(r.Context(), nil)
	if err != nil {
		adminWriteJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Your reply could not be saved."})
		return
	}
	defer tx.Rollback()
	result, err := tx.ExecContext(r.Context(), `INSERT INTO mp_support_messages(conversation_id, sender_user_id, sender_role, body, created_at) SELECT id, ?, 'admin', ?, ? FROM mp_support_conversations WHERE id = ?`, adminID, body, now, payload.ConversationID)
	if err != nil {
		adminWriteJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Your reply could not be saved."})
		return
	}
	if affected, _ := result.RowsAffected(); affected != 1 {
		adminWriteJSON(w, http.StatusNotFound, map[string]string{"error": "Support conversation not found."})
		return
	}
	if _, err := tx.ExecContext(r.Context(), `UPDATE mp_support_conversations SET status = 'waiting', updated_at = ? WHERE id = ?`, now, payload.ConversationID); err != nil {
		adminWriteJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Your reply could not be saved."})
		return
	}
	if err := tx.Commit(); err != nil {
		adminWriteJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Your reply could not be saved."})
		return
	}
	adminWriteJSON(w, http.StatusCreated, map[string]bool{"ok": true})
}

func (h *adminHandler) adminSupportResolve(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		adminMethodNotAllowed(w, http.MethodPost)
		return
	}
	if !adminSameOriginRequest(r) {
		adminWriteJSON(w, http.StatusForbidden, map[string]string{"error": "Origin check failed."})
		return
	}
	var payload struct {
		ConversationID int64 `json:"conversationId"`
	}
	if err := adminDecodeJSONBody(w, r, 1024, &payload); err != nil || payload.ConversationID <= 0 {
		adminWriteJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid conversation."})
		return
	}
	result, err := h.db.ExecContext(r.Context(), `UPDATE mp_support_conversations SET status = 'resolved', updated_at = ? WHERE id = ?`, time.Now().Unix(), payload.ConversationID)
	if err != nil {
		adminWriteJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "The conversation could not be resolved."})
		return
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		adminWriteJSON(w, http.StatusNotFound, map[string]string{"error": "Support conversation not found."})
		return
	}
	adminWriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func adminMethodNotAllowed(w http.ResponseWriter, allow string) {
	w.Header().Set("Allow", allow)
	adminWriteJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "Method not allowed."})
}

func adminWriteJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

// AdminObservability records safe 5xx metadata and recovers panics at the
// application boundary. It deliberately does not persist raw error strings,
// request bodies, cookies, query strings, or stack traces.
func AdminObservability(next http.Handler, db *sql.DB) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestID := adminRandomHexToken(8)
		if requestID == "" {
			requestID = strconv.FormatInt(time.Now().UnixNano(), 16)
		}
		w.Header().Set("X-Request-ID", requestID)
		wrapped := &adminObservedResponseWriter{ResponseWriter: w}
		panicked := false
		defer func() {
			if recovered := recover(); recovered != nil {
				panicked = true
				log.Printf("MoviPilot request panic recovered; request_id=%s route=%s", requestID, adminSafeRoute(r.URL.Path))
				if wrapped.status == 0 {
					http.Error(wrapped, "Internal server error", http.StatusInternalServerError)
				}
			}
			status := wrapped.status
			if status == 0 {
				status = http.StatusOK
			}
			if db != nil && (status >= 500 || panicked) {
				message := "http_5xx"
				if panicked {
					message = "panic_recovered"
				}
				ctx, cancel := context.WithTimeout(context.Background(), 750*time.Millisecond)
				_, _ = db.ExecContext(ctx, `INSERT INTO mp_application_errors(occurred_at, method, route, status, message, request_id) VALUES(?, ?, ?, ?, ?, ?)`, time.Now().Unix(), r.Method, adminSafeRoute(r.URL.Path), status, message, requestID)
				cancel()
			}
		}()
		next.ServeHTTP(wrapped, r)
	})
}

type adminObservedResponseWriter struct {
	http.ResponseWriter
	status int
}

func (w *adminObservedResponseWriter) WriteHeader(status int) {
	if w.status != 0 {
		return
	}
	w.status = status
	w.ResponseWriter.WriteHeader(status)
}

func (w *adminObservedResponseWriter) Write(data []byte) (int, error) {
	if w.status == 0 {
		w.WriteHeader(http.StatusOK)
	}
	return w.ResponseWriter.Write(data)
}

func (w *adminObservedResponseWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }

// Preserve common optional ResponseWriter interfaces for existing endpoints.
func (w *adminObservedResponseWriter) Flush() {
	if w.status == 0 {
		w.WriteHeader(http.StatusOK)
	}
	if flusher, ok := w.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}

func (w *adminObservedResponseWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	hijacker, ok := w.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, errors.New("response writer does not support hijacking")
	}
	return hijacker.Hijack()
}

func (w *adminObservedResponseWriter) Push(target string, options *http.PushOptions) error {
	pusher, ok := w.ResponseWriter.(http.Pusher)
	if !ok {
		return http.ErrNotSupported
	}
	return pusher.Push(target, options)
}

func adminSafeRoute(route string) string {
	if route == "" || len(route) > 120 || strings.Contains(route, "?") {
		return "/unknown"
	}
	if strings.HasPrefix(route, "/templates/") || strings.HasPrefix(route, "/img/") {
		return "/static"
	}
	return route
}

// RecordApplicationError can be called from handlers that catch an internal
// dependency failure but still return a successful fallback response.
func RecordApplicationError(db *sql.DB, route, message string) {
	if db == nil {
		return
	}
	allowedMessages := map[string]bool{"tmdb_failure": true, "email_delivery_failure": true, "background_job_failure": true, "storage_operation_failure": true}
	if !allowedMessages[message] {
		message = "internal_dependency_failure"
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	_, _ = db.ExecContext(ctx, `INSERT INTO mp_application_errors(occurred_at, method, route, status, message, request_id) VALUES(?, 'INTERNAL', ?, 500, ?, '')`, time.Now().Unix(), adminSafeRoute(route), message)
}

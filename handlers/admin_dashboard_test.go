package handlers

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestNormalizeAnalyticsPath(t *testing.T) {
	cases := []struct{ input, want string }{
		{"/", "/"},
		{"/community?tab=chat", "/community"},
		{"/dashboard/", "/dashboard"},
		{"/api/community/users", ""},
		{"/templates/css/site.css", ""},
		{"/admin", ""},
		{"//outside.example/path", ""},
		{"/community/chat", ""},
	}
	for _, item := range cases {
		if got := adminNormalizeAnalyticsPath(item.input); got != item.want {
			t.Errorf("adminNormalizeAnalyticsPath(%q) = %q; want %q", item.input, got, item.want)
		}
	}
}

func TestMondayStart(t *testing.T) {
	day := time.Date(2026, 10, 30, 0, 0, 0, 0, time.UTC) // Friday
	got := adminMondayStart(day)
	want := time.Date(2026, 10, 26, 0, 0, 0, 0, time.UTC)
	if !got.Equal(want) {
		t.Fatalf("adminMondayStart() = %s; want %s", got, want)
	}
}

func TestAdminSameOriginRequest(t *testing.T) {
	cases := []struct {
		name   string
		host   string
		origin string
		want   bool
	}{
		{"same origin", "www.movipilot.site", "https://www.movipilot.site", true},
		{"same origin with port", "localhost:8080", "http://localhost:8080", true},
		{"different host", "www.movipilot.site", "https://movipilot.site.evil.example", false},
		{"missing origin", "www.movipilot.site", "", false},
		{"unsupported scheme", "www.movipilot.site", "javascript://www.movipilot.site", false},
		{"userinfo", "www.movipilot.site", "https://attacker@www.movipilot.site", false},
	}
	for _, item := range cases {
		t.Run(item.name, func(t *testing.T) {
			r := httptest.NewRequest("POST", "https://"+item.host+"/api/community/support", nil)
			r.Host = item.host
			if item.origin != "" {
				r.Header.Set("Origin", item.origin)
			}
			if got := adminSameOriginRequest(r); got != item.want {
				t.Fatalf("adminSameOriginRequest() = %v; want %v", got, item.want)
			}
		})
	}
}

func TestValidAnalyticsCookie(t *testing.T) {
	r := httptest.NewRequest("GET", "/", nil)
	r.AddCookie(&http.Cookie{Name: analyticsVisitorKey, Value: strings.Repeat("a", 64)})
	if got := validAnalyticsCookie(r, analyticsVisitorKey); got != strings.Repeat("a", 64) {
		t.Fatalf("validAnalyticsCookie() returned %q", got)
	}

	r = httptest.NewRequest("GET", "/", nil)
	r.AddCookie(&http.Cookie{Name: analyticsVisitorKey, Value: "not-a-token"})
	if got := validAnalyticsCookie(r, analyticsVisitorKey); got != "" {
		t.Fatalf("invalid analytics cookie should be rejected; got %q", got)
	}
}

package handlers

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"MoviPilot/funcs/storage"
)

func TestNormalizeCommunityDate(t *testing.T) {
	got := normalizeCommunityDate("2024-06-15 12:30:00")
	if got != "2024-06-15T12:30:00Z" {
		t.Fatalf("normalizeCommunityDate() = %q, want RFC3339 UTC date", got)
	}
	if normalizeCommunityDate("") != "" {
		t.Fatal("empty date should remain empty")
	}
}

func TestCommunitySameOriginValidation(t *testing.T) {
	req := httptest.NewRequest("POST", "http://localhost:8080/api/community/friend", strings.NewReader(`{}`))
	req.Header.Set("Origin", "http://localhost:8080")
	if !communityRequestIsSameOrigin(req) {
		t.Fatal("same-origin POST should be accepted")
	}

	req.Header.Set("Origin", "https://attacker.example")
	if communityRequestIsSameOrigin(req) {
		t.Fatal("cross-origin POST should be rejected")
	}

	req.Header.Del("Origin")
	req.Header.Del("Referer")
	if communityRequestIsSameOrigin(req) {
		t.Fatal("POST without Origin/Referer should be rejected")
	}
}

func TestCommunityPublicIDPattern(t *testing.T) {
	if !communityPublicIDPattern.MatchString("MP0123456789ABCDEF0123") {
		t.Fatal("valid MoviPilot public ID should match")
	}
	if communityPublicIDPattern.MatchString("MP123") {
		t.Fatal("partial ID must not match")
	}
	if communityPublicIDPattern.MatchString("MP0123456789ABCDEG0123") {
		t.Fatal("non-hexadecimal ID must not match")
	}
}

func TestCommunityDTODoesNotExposePrivateFields(t *testing.T) {
	encoded, err := json.Marshal(toCommunityMemberDTO(storage.CommunityMember{
		ID:          77,
		PublicID:    "MP0123456789ABCDEF0123",
		Username:    "member_abc123",
		FullName:    "Community Member",
		CreatedAt:   "2024-06-15 12:30:00",
		FriendCount: 3,
		MarkedByMe:  true,
	}))
	if err != nil {
		t.Fatalf("marshal member DTO: %v", err)
	}
	body := string(encoded)
	for _, forbidden := range []string{"email", "password", "googleId", "\"id\"", "77"} {
		if strings.Contains(strings.ToLower(body), strings.ToLower(forbidden)) {
			t.Fatalf("public DTO unexpectedly contains %q: %s", forbidden, body)
		}
	}
	for _, required := range []string{"publicId", "username", "fullName", "createdAt", "friendCount", "markedByMe"} {
		if !strings.Contains(body, `"`+required+`"`) {
			t.Fatalf("public DTO missing %q: %s", required, body)
		}
	}
}

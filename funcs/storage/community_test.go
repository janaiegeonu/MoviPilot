package storage

import "testing"

func TestUsernameSlug(t *testing.T) {
	cases := map[string]string{
		"Janai Example":       "janai_example",
		"  A Film Lover  ":    "a_film_lover",
		"!!!":                 "",
		"MoviPilot-Community": "movipilot_community",
	}
	for input, want := range cases {
		if got := usernameSlug(input); got != want {
			t.Errorf("usernameSlug(%q) = %q, want %q", input, got, want)
		}
	}
}

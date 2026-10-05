package handlers

import "net/http"

func TermsHandler(w http.ResponseWriter, r *http.Request) {

	if r.Method != http.MethodGet {
		http.Error(
			w,
			"Method Not Allowed",
			http.StatusMethodNotAllowed,
		)
		return
	}

	err := renderTemplate(
		w,
		"terms.html",
		nil,
	)

	if err != nil {
		http.Error(
			w,
			"500 : Failed to render Terms of Service",
			http.StatusInternalServerError,
		)
		return
	}
}

func PrivacyPolicyHandler(w http.ResponseWriter, r *http.Request) {

	if r.Method != http.MethodGet {
		http.Error(
			w,
			"Method Not Allowed",
			http.StatusMethodNotAllowed,
		)
		return
	}

	err := renderTemplate(
		w,
		"policy.html",
		nil,
	)

	if err != nil {
		http.Error(
			w,
			"500 : Failed to render Privacy Policy",
			http.StatusInternalServerError,
		)
		return
	}
}

package handlers

import (
	"bytes"
	"html/template"
	"net/http"
)

func renderTemplate(w http.ResponseWriter, tmplName string, data interface{}) error {
	tmpl, err := template.ParseFiles(
		"templates/splash.html",
		"templates/homepage.html",
		"templates/signup.html",
		"templates/login.html",
		"templates/forgot-password.html",
		"templates/verifycode.html",
		"templates/reset-password.html",
		"templates/terms.html",
		"templates/policy.html",
		"templates/dashboard.html",
		"templates/series_page.html",
		"templates/movie_page.html",
	)

	if err != nil {
		http.Error(
			w,
			"Template Parsing Error: "+err.Error(),
			http.StatusInternalServerError,
		)
		return err
	}

	var buf bytes.Buffer

	err = tmpl.ExecuteTemplate(&buf, tmplName, data)
	if err != nil {
		http.Error(
			w,
			"Template Execution Error: "+err.Error(),
			http.StatusInternalServerError,
		)
		return err
	}

	_, err = w.Write(buf.Bytes())
	if err != nil {
		return err
	}

	return nil
}

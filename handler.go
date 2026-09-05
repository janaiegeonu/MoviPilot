package main

import (
	"html/template"
	"net/http"
)

func renderTemplate(w http.ResponseWriter, tmplName string, data interface{}) error {
	tmpl, err := template.ParseFiles("templates/splash.html", "templates/home.html", "templates/signup.html")
	if err != nil {
		http.Error(w, "Template Parsing Error: "+err.Error(), http.StatusInternalServerError)
		return nil
	}
	err = tmpl.ExecuteTemplate(w, tmplName, data)
	if err != nil {
		http.Error(w, "Template Execution Error: "+err.Error(), http.StatusInternalServerError)
		return nil
	}
	return nil

}

func SplashIntro(w http.ResponseWriter, r *http.Request) {

	if r.Method == http.MethodGet {
		err := renderTemplate(w, "splash.html", nil)
		if err != nil {
			http.Error(w, "404 : Page Not Found", http.StatusNotFound)
			return
		}
	}

}

func DisplayHome(w http.ResponseWriter, r *http.Request) {

	if r.Method == http.MethodGet {
		err := renderTemplate(w, "home.html", nil)
		if err != nil {
			http.Error(w, "404 : Page Not Found", http.StatusNotFound)
			return
		}
	}

}

func DisplaySignup(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		err := renderTemplate(w, "signup.html", nil)
		if err != nil {
			http.Error(w, "404 : Page Not Found", http.StatusNotFound)
			return
		}
	}

}

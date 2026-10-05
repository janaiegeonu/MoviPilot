package handlers

import (
	"MoviPilot/funcs/auth"
	"MoviPilot/funcs/form"
	"MoviPilot/funcs/storage"
	"bytes"
	"fmt"
	"html/template"
	"net/http"
	"os"
	"strconv"
	"time"

	"gopkg.in/mail.v2"
)

func SignupHandler(w http.ResponseWriter, r *http.Request) {

	// GET → show signup page
	if r.Method == http.MethodGet {
		err := renderTemplate(w, "signup.html", nil)

		if err != nil {
			http.Error(w, "404 : Page Not Found", http.StatusNotFound)
			return
		}

		return
	}

	// Only POST is allowed after this point
	if r.Method != http.MethodPost {
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}

	type SignupPageData struct {
		FullName             string
		Email                string
		FullNameError        string
		EmailError           string
		PasswordError        string
		ConfirmPasswordError string
		TermsError           string
		TermsAccepted        bool
	}

	fullName := r.FormValue("fullname")
	email := r.FormValue("email")
	password := r.FormValue("password")
	confirmPassword := r.FormValue("confirmPassword")
	terms := r.FormValue("terms")

	var data SignupPageData
	var hasError bool

	// NAME
	validName, err := form.ValidateName(fullName)

	if err != nil {
		data.FullName = fullName
		data.FullNameError = err.Error()
		hasError = true
	} else {
		data.FullName = validName
	}

	// EMAIL
	validEmail, err := form.ValidateEmail(email)

	if err != nil {
		data.Email = email
		data.EmailError = err.Error()
		hasError = true
	} else {
		data.Email = validEmail
	}

	// checking if email already exist in database
	exists, err := storage.EmailExists(email)

	if err != nil {
		http.Error(w, "Unable to check email", http.StatusInternalServerError)
		return
	}

	if exists {
		data.Email = email
		data.EmailError = "Email already registered to MoviPilot"
		hasError = true
	} else {
		data.Email = validEmail
	}

	// PASSWORD
	_, err = form.ValidatePassword(password)

	if err != nil {
		data.PasswordError = err.Error()
		hasError = true
	}

	// CONFIRM PASSWORD
	err = form.ValidatePasswordMatch(password, confirmPassword)

	if err != nil {
		data.ConfirmPasswordError = err.Error()
		hasError = true
	}

	// TERMS
	err = form.ValidateTerms(terms)

	if err != nil {
		data.TermsError = err.Error()
		hasError = true
	} else {
		data.TermsAccepted = true
	}

	// STOP HERE IF VALIDATION FAILED
	if hasError {
		err := renderTemplate(w, "signup.html", data)

		if err != nil {
			http.Error(w, "500 : Failed to render signup page", http.StatusInternalServerError)
		}

		return
	}

	hashedPassword, err := auth.HashPassword(password)
	if err != nil {
		http.Error(w, "Unable to process password", http.StatusInternalServerError)
		return
	}

	user := storage.User{
		FullName:     fullName,
		Email:        email,
		PasswordHash: hashedPassword,
	}

	err = storage.CreateUser(user)
	if err != nil {
		http.Error(w, "Unable to create account", http.StatusInternalServerError)
		return
	}

	type WelcomeEmailData struct {
		FullName string
		HomeURL  string
		Year     int
	}

	tmpl, err := template.ParseFiles(
		"templates/welcomeEmail.html",
	)

	if err != nil {

		fmt.Println(
			"EMAIL TEMPLATE PARSE ERROR:",
			err,
		)

		http.Error(
			w,
			"500 : Failed to load email template",
			http.StatusInternalServerError,
		)

		return
	}

	emailData := WelcomeEmailData{
		FullName: fullName,
		HomeURL:  "http://localhost:8080/homepage",
		Year:     time.Now().Year(),
	}

	var bodyBuffer bytes.Buffer

	err = tmpl.Execute(
		&bodyBuffer,
		emailData,
	)

	m := mail.NewMessage()

	m.SetAddressHeader(
		"From",
		os.Getenv("BREVO_SENDER_EMAIL"),
		os.Getenv("BREVO_SENDER_NAME"),
	)

	m.SetHeader(
		"To",
		email,
	)

	m.SetHeader(
		"Subject",
		"Welcome to MoviPilot — Your Personal Movie Compass",
	)

	m.SetBody(
		"text/html",
		bodyBuffer.String(),
	)
	port, _ := strconv.Atoi(
		os.Getenv("BREVO_SMTP_PORT"),
	)

	d := mail.NewDialer(
		os.Getenv("BREVO_SMTP_HOST"),
		port,
		os.Getenv("BREVO_SMTP_LOGIN"),
		os.Getenv("BREVO_SMTP_KEY"),
	)

	err = d.DialAndSend(m)

	http.Redirect(w, r, "/login", http.StatusSeeOther)

}

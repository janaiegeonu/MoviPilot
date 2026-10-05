package handlers

import (
	"MoviPilot/funcs/auth"
	"MoviPilot/funcs/storage"
	"bytes"
	"encoding/json"
	"fmt"
	"html/template"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
	"gopkg.in/mail.v2"
)

type VerificationPageData struct {
	Email string
}

/* =========================================================
   FORGOT PASSWORD HANDLER
   ========================================================= */

func ForgotPasswordHandler(w http.ResponseWriter, r *http.Request) {

	if r.Method == http.MethodGet {

		err := renderTemplate(
			w,
			"forgot-password.html",
			nil,
		)

		if err != nil {
			http.Error(
				w,
				"500 : Failed to render forgot-password page",
				http.StatusInternalServerError,
			)
		}

		return
	}

	if r.Method != http.MethodPost {
		http.Error(
			w,
			"Method not allowed",
			http.StatusMethodNotAllowed,
		)
		return
	}

	w.Header().Set(
		"Content-Type",
		"application/json",
	)

	email := strings.TrimSpace(
		r.FormValue("email"),
	)

	/* -----------------------------------------------------
	   1. CHECK EMPTY EMAIL
	   ----------------------------------------------------- */

	if email == "" {

		w.WriteHeader(http.StatusBadRequest)

		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"field":   "email",
			"error":   "Email is required",
		})

		return
	}

	/* -----------------------------------------------------
	   2. CHECK IF EMAIL EXISTS
	   ----------------------------------------------------- */

	exists, err := storage.EmailExists(email)

	if err != nil {

		fmt.Println(
			"EMAIL EXISTS CHECK ERROR:",
			err,
		)

		http.Error(
			w,
			"500 : Failed to check email",
			http.StatusInternalServerError,
		)

		return
	}

	/* -----------------------------------------------------
	   3. EMAIL DOES NOT EXIST
	   ----------------------------------------------------- */

	if !exists {

		w.WriteHeader(http.StatusBadRequest)

		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"field":   "email",
			"error":   "Email not registered to MoviPilot",
		})

		return
	}

	/* -----------------------------------------------------
	   4. GENERATE 6-DIGIT CODE
	   ----------------------------------------------------- */

	verificationCode := auth.GenerateNumericCode()

	if verificationCode == "" {

		http.Error(
			w,
			"500 : Failed to generate verification code",
			http.StatusInternalServerError,
		)

		return
	}

	/* -----------------------------------------------------
	   5. HASH VERIFICATION CODE
	   ----------------------------------------------------- */

	hashedCode, err := bcrypt.GenerateFromPassword(
		[]byte(verificationCode),
		bcrypt.DefaultCost,
	)

	if err != nil {

		http.Error(
			w,
			"500 : Failed to secure verification code",
			http.StatusInternalServerError,
		)

		return
	}

	expiresAt := time.Now().Add(
		10 * time.Minute,
	)

	/* -----------------------------------------------------
	   6. SAVE CODE TO DATABASE
	   ----------------------------------------------------- */

	err = storage.SavePasswordResetCode(
		email,
		string(hashedCode),
		expiresAt,
	)

	if err != nil {

		fmt.Println(
			"SAVE PASSWORD RESET CODE ERROR:",
			err,
		)

		http.Error(
			w,
			"500 : Failed to save verification code",
			http.StatusInternalServerError,
		)

		return
	}

	/* -----------------------------------------------------
	   7. PREPARE EMAIL
	   ----------------------------------------------------- */

	type PasswordResetEmailData struct {
		VerificationCode string
		CopyCodeURL      string
		Year             int
	}

	emailData := PasswordResetEmailData{
		VerificationCode: verificationCode,
		CopyCodeURL:      "http://localhost:8080/copy-code",
		Year:             time.Now().Year(),
	}

	tmpl, err := template.ParseFiles(
		"templates/emailcode.html",
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

	var bodyBuffer bytes.Buffer

	err = tmpl.Execute(
		&bodyBuffer,
		emailData,
	)

	if err != nil {

		fmt.Println(
			"EMAIL TEMPLATE EXECUTION ERROR:",
			err,
		)

		http.Error(
			w,
			"500 : Failed to create email",
			http.StatusInternalServerError,
		)

		return
	}

	/* -----------------------------------------------------
	   8. CREATE EMAIL
	   ----------------------------------------------------- */

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
		"MoviPilot Verification Code",
	)

	m.SetBody(
		"text/html",
		bodyBuffer.String(),
	)

	/* -----------------------------------------------------
	   9. SMTP
	   ----------------------------------------------------- */

	port, err := strconv.Atoi(
		os.Getenv("BREVO_SMTP_PORT"),
	)

	if err != nil {

		http.Error(
			w,
			"Invalid SMTP port",
			http.StatusInternalServerError,
		)

		return
	}

	d := mail.NewDialer(
		os.Getenv("BREVO_SMTP_HOST"),
		port,
		os.Getenv("BREVO_SMTP_LOGIN"),
		os.Getenv("BREVO_SMTP_KEY"),
	)

	/* -----------------------------------------------------
	   10. SEND EMAIL
	   ----------------------------------------------------- */

	err = d.DialAndSend(m)

	if err != nil {

		fmt.Println(
			"EMAIL ERROR:",
			err,
		)

		http.Error(
			w,
			"500 : Failed to send verification email",
			http.StatusInternalServerError,
		)

		return
	}

	/* -----------------------------------------------------
	   11. KEEP THE EMAIL IN THE RESET FLOW

	   The verification page reads this HttpOnly cookie
	   so the page can know which account the code belongs to.
	   ----------------------------------------------------- */

	http.SetCookie(
		w,
		&http.Cookie{
			Name:     "movipilot_reset_email",
			Value:    email,
			Path:     "/",
			HttpOnly: true,
			SameSite: http.SameSiteLaxMode,
			MaxAge:   10 * 60,
		},
	)

	/* -----------------------------------------------------
	   12. SUCCESS

	   The existing forgot-password JavaScript should use
	   this JSON response to navigate to /verify-code.
	   ----------------------------------------------------- */

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":  true,
		"redirect": "/verify-code",
	})
}

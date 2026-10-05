package handlers

import (
	"MoviPilot/funcs/auth"
	"MoviPilot/funcs/storage"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
)

func VerificationCodeHandler(w http.ResponseWriter, r *http.Request) {

	// ============================================
	// GET
	// ============================================

	if r.Method == http.MethodGet {

		resetCookie, err := r.Cookie(
			"movipilot_reset_email",
		)

		if err != nil ||
			strings.TrimSpace(resetCookie.Value) == "" {

			http.Redirect(
				w,
				r,
				"/forgot-password",
				http.StatusSeeOther,
			)

			return
		}

		email := strings.ToLower(
			strings.TrimSpace(resetCookie.Value),
		)

		pageData := VerificationPageData{
			Email: email,
		}

		err = renderTemplate(
			w,
			"verifycode.html",
			pageData,
		)

		if err != nil {

			fmt.Println(
				"VERIFY PAGE RENDER ERROR:",
				err,
			)

			http.Error(
				w,
				"500 : Failed to render verifycode page",
				http.StatusInternalServerError,
			)
		}

		return
	}

	// ============================================
	// POST ONLY
	// ============================================

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

	// ============================================
	// 1. GET EMAIL FROM RESET COOKIE
	// ============================================

	resetCookie, err := r.Cookie(
		"movipilot_reset_email",
	)

	if err != nil ||
		strings.TrimSpace(resetCookie.Value) == "" {

		w.WriteHeader(
			http.StatusUnauthorized,
		)

		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Your verification session has expired. Please request a new code.",
		})

		return
	}

	email := strings.ToLower(
		strings.TrimSpace(resetCookie.Value),
	)

	// ============================================
	// 2. GET SIX DIGIT CODE
	// ============================================

	code := strings.TrimSpace(
		r.FormValue("verification_code"),
	)

	// ============================================
	// 3. VALIDATE CODE FORMAT
	// ============================================

	if !auth.IsSixDigitCode(code) {

		w.WriteHeader(
			http.StatusBadRequest,
		)

		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"field":   "verification_code",
			"error":   "Please enter the 6-digit verification code.",
		})

		return
	}

	// ============================================
	// 4. GET HASH FROM DATABASE
	// ============================================

	hashedCode, expiresAt, err :=
		storage.GetPasswordResetCode(email)

	// No row exists
	if errors.Is(err, sql.ErrNoRows) {

		w.WriteHeader(
			http.StatusBadRequest,
		)

		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "This verification code is invalid or has expired.",
		})

		return
	}

	// Real database error
	if err != nil {

		fmt.Println(
			"GET PASSWORD RESET CODE ERROR:",
			err,
		)

		http.Error(
			w,
			"500 : Failed to retrieve verification code",
			http.StatusInternalServerError,
		)

		return
	}

	// ============================================
	// 5. CHECK EXPIRY
	// ============================================

	if time.Now().After(expiresAt) {

		w.WriteHeader(
			http.StatusBadRequest,
		)

		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "This verification code has expired. Please request a new code.",
		})

		return
	}

	// ============================================
	// 6. COMPARE CODE WITH BCRYPT HASH
	// ============================================

	compareErr := bcrypt.CompareHashAndPassword(
		[]byte(hashedCode),
		[]byte(code),
	)

	if compareErr != nil {

		fmt.Println(
			"VERIFY BCRYPT ERROR:",
			compareErr,
		)

		w.WriteHeader(
			http.StatusBadRequest,
		)

		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "The verification code is incorrect.",
		})

		return
	}

	// ============================================
	// 7. VALID CODE
	// ============================================

	err = storage.DeletePasswordResetCode(
		email,
	)

	if err != nil {

		fmt.Println(
			"DELETE PASSWORD RESET CODE ERROR:",
			err,
		)

		http.Error(
			w,
			"500 : Failed to complete verification",
			http.StatusInternalServerError,
		)

		return
	}

	// ============================================
	// 8. MARK RESET FLOW AS VERIFIED
	// ============================================

	http.SetCookie(
		w,
		&http.Cookie{
			Name:     "movipilot_reset_verified",
			Value:    email,
			Path:     "/",
			HttpOnly: true,
			SameSite: http.SameSiteLaxMode,
			MaxAge:   10 * 60,
		},
	)

	// ============================================
	// 9. SUCCESS
	// ============================================

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":  true,
		"redirect": "/reset-password",
	})
}

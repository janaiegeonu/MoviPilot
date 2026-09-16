package form

import (
	"errors"
	"net/mail"
	"strings"
	"unicode"
)

//User fullname form validation

func ValidateName(text string) (string, error) {
	text = strings.TrimSpace(text)

	if text == "" {
		return "", errors.New("full name is required")
	}

	if !strings.Contains(text, " ") {
		return "", errors.New("please enter your full name")
	}

	for _, char := range text {
		if unicode.IsDigit(char) {
			return "", errors.New("name cannot contain numbers")
		}

		if unicode.IsPunct(char) && char != '-' && char != '\'' {
			return "", errors.New("name contains invalid characters")
		}
	}

	return text, nil
}

//User email form validation

func ValidateEmail(text string) (string, error) {
	text = strings.TrimSpace(text)

	if text == "" {
		return "", errors.New("email is required")
	}

	_, err := mail.ParseAddress(text)
	if err != nil {
		return "", errors.New("invalid email address")
	}

	return text, nil
}

// User password form validation
func ValidatePassword(text string) (string, error) {
	if len(text) < 8 {
		return "", errors.New("password must be at least 8 characters")
	}

	hasDigit := false
	hasLetter := false

	for _, char := range text {
		if unicode.IsDigit(char) {
			hasDigit = true
		}

		if unicode.IsLetter(char) {
			hasLetter = true
		}
	}

	if !hasDigit {
		return "", errors.New("password must contain at least one number")
	}

	if !hasLetter {
		return "", errors.New("password must contain at least one letter")
	}

	return text, nil
}

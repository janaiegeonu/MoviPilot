package main

import (
	"MoviPilot/funcs/storage"
	"fmt"
	"log"
	"net/http"

	"github.com/joho/godotenv"
)

func main() {

	err := godotenv.Load()

	if err != nil {
		log.Println("Warning: .env file not found")
	}

	http.Handle("/templates/", http.StripPrefix("/templates/", http.FileServer(http.Dir("templates"))))
	http.Handle("/img/", http.StripPrefix("/img/", http.FileServer(http.Dir("img"))))
	http.HandleFunc("/", SplashIntro)
	http.HandleFunc("/homepage", HomepageHandler)
	http.HandleFunc("/movie", MovieDetailHandler)
	http.HandleFunc("/signup", SignupHandler)
	http.HandleFunc("/auth/google", GoogleSignupHandler)
	http.HandleFunc("/auth/google/callback", GoogleCallbackHandler)
	http.HandleFunc("/login", LoginHandler)
	http.HandleFunc("/forgot-password", ForgotPasswordHandler)
	http.HandleFunc("/verify-code", VerificationCodeHandler)
	http.HandleFunc("/reset-password", ResetPasswordHandler)

	storage.InitDatabase()
	fmt.Println(storage.RGBY("MoviPilot server running currently on http://localhost:8080"))
	http.ListenAndServe(":8080", nil)

}

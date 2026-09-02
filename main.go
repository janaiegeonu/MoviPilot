package main

import (
	"fmt"
	"net/http"
)

func main() {
	http.Handle("/templates/", http.StripPrefix("/templates/", http.FileServer(http.Dir("templates"))))
	http.Handle("/img/", http.StripPrefix("/img/", http.FileServer(http.Dir("img"))))
	http.HandleFunc("/", DisplayIntro)
	http.HandleFunc("/home", DisplayHome)
	http.HandleFunc("/signup", DisplaySignup)
	fmt.Println("server running currently on http://localhost:8080")
	http.ListenAndServe(":8080", nil)
}

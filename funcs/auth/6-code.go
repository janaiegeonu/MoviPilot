package auth

import (
	"crypto/rand"
	"fmt"
	"math/big"
)

func GenerateNumericCode() string {
	max := big.NewInt(1000000)
	n, err := rand.Int(rand.Reader, max)
	if err != nil {
		return ""
	}
	return fmt.Sprintf("%06d", n.Int64())
}

func IsSixDigitCode(code string) bool {

	if len(code) != 6 {
		return false
	}

	for _, character := range code {

		if character < '0' || character > '9' {
			return false
		}
	}

	return true
}

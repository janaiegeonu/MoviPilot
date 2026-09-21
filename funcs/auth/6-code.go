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

package ai

import (
	"context"
	"errors"
	"strings"
)

const keychainService = "io.arlecchino.ide.ai"

var ErrSecretNotFound = errors.New("ai secret not found")

type SecretStore interface {
	FindSecret(ctx context.Context, ref string) (string, error)
	SaveSecret(ctx context.Context, ref string, value string) error
	ClearSecret(ctx context.Context, ref string) error
}

func secretRefForProvider(providerID string) string {
	providerID = strings.TrimSpace(providerID)
	if providerID == "" {
		providerID = "default"
	}
	return "provider:" + providerID
}

package ai

import (
	"context"
	"errors"
	"fmt"
	"strings"
)

const keychainService = "io.arlecchino.ide.ai"

var ErrSecretNotFound = errors.New("ai secret not found")

type SecretStore interface {
	FindSecret(ctx context.Context, ref string) (string, error)
	SaveSecret(ctx context.Context, ref string, value string) error
	ClearSecret(ctx context.Context, ref string) error
}

type unsupportedSecretStore struct{}

func secretRefForProvider(providerID string) string {
	providerID = strings.TrimSpace(providerID)
	if providerID == "" {
		providerID = "default"
	}
	return "provider:" + providerID
}

func (unsupportedSecretStore) FindSecret(context.Context, string) (string, error) {
	return "", ErrSecretNotFound
}

func (unsupportedSecretStore) SaveSecret(context.Context, string, string) error {
	return fmt.Errorf("secure AI secret storage is only available on macOS")
}

func (unsupportedSecretStore) ClearSecret(context.Context, string) error {
	return nil
}

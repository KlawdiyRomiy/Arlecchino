//go:build !darwin

package ai

import (
	"context"
	"fmt"
)

type unsupportedSecretStore struct{}

func DefaultSecretStore() SecretStore {
	return unsupportedSecretStore{}
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

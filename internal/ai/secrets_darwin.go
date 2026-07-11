//go:build darwin && !arle_swift_bridge

package ai

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"arlecchino/internal/keychain"
)

type keychainSecretStore struct{}

func DefaultSecretStore() SecretStore {
	return keychainSecretStore{}
}

func (keychainSecretStore) FindSecret(ctx context.Context, ref string) (string, error) {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return "", ErrSecretNotFound
	}
	if err := ctxErr(ctx); err != nil {
		return "", err
	}
	value, err := keychain.Find(keychainService, ref)
	if errors.Is(err, keychain.ErrNotFound) {
		return "", ErrSecretNotFound
	}
	return value, err
}

func (keychainSecretStore) SaveSecret(ctx context.Context, ref string, value string) error {
	ref = strings.TrimSpace(ref)
	value = strings.TrimSpace(value)
	if ref == "" || value == "" {
		return fmt.Errorf("secret ref and value are required")
	}
	if err := ctxErr(ctx); err != nil {
		return err
	}
	return keychain.Save(keychainService, ref, value)
}

func (keychainSecretStore) ClearSecret(ctx context.Context, ref string) error {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return nil
	}
	if err := ctxErr(ctx); err != nil {
		return err
	}
	return keychain.Delete(keychainService, ref)
}

func ctxErr(ctx context.Context) error {
	if ctx == nil {
		return nil
	}
	return ctx.Err()
}

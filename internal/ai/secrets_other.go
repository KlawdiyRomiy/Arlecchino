//go:build !darwin

package ai

func DefaultSecretStore() SecretStore {
	return unsupportedSecretStore{}
}

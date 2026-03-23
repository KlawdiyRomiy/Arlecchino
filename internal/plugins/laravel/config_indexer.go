package laravel

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

type ConfigKey struct {
	Key         string `json:"key"`
	Value       string `json:"value,omitempty"`
	File        string `json:"file"`
	Description string `json:"description,omitempty"`
}

type ConfigIndexer struct {
	projectPath string
}

func NewConfigIndexer(projectPath string) *ConfigIndexer {
	return &ConfigIndexer{projectPath: projectPath}
}

func (c *ConfigIndexer) Index() ([]ConfigKey, error) {
	keys := []ConfigKey{}
	configDir := filepath.Join(c.projectPath, "config")

	if _, err := os.Stat(configDir); os.IsNotExist(err) {
		return keys, nil
	}

	err := filepath.Walk(configDir, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() || !strings.HasSuffix(path, ".php") {
			return err
		}

		fileName := strings.TrimSuffix(filepath.Base(path), ".php")
		fileKeys := c.parseConfigFile(path, fileName)
		keys = append(keys, fileKeys...)
		return nil
	})

	return keys, err
}

func (c *ConfigIndexer) parseConfigFile(filePath, fileName string) []ConfigKey {
	file, err := os.Open(filePath)
	if err != nil {
		return []ConfigKey{}
	}
	defer file.Close()

	keys := []ConfigKey{}
	scanner := bufio.NewScanner(file)

	keyPattern := regexp.MustCompile(`['"](\w+)['"]\s*=>\s*(.+?),?\s*(?://(.+))?$`)
	envPattern := regexp.MustCompile(`env\(['"]([^'"]+)['"]`)

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())

		matches := keyPattern.FindStringSubmatch(line)
		if len(matches) < 2 {
			continue
		}

		key := fileName + "." + matches[1]
		value := strings.TrimSpace(matches[2])
		description := ""

		if len(matches) > 3 && matches[3] != "" {
			description = strings.TrimSpace(matches[3])
		}

		if envMatches := envPattern.FindStringSubmatch(value); len(envMatches) > 1 {
			description = "ENV: " + envMatches[1]
		}

		keys = append(keys, ConfigKey{
			Key:         key,
			Value:       value,
			File:        fileName,
			Description: description,
		})
	}

	return keys
}

func (c *ConfigIndexer) ExportJSON(keys []ConfigKey) (string, error) {
	data, err := json.MarshalIndent(keys, "", "  ")
	if err != nil {
		return "", err
	}
	return string(data), nil
}

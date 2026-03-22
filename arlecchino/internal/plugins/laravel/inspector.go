package laravel

import (
	"encoding/json"
	"fmt"
)

type ProjectStructure struct {
	Routes     []RouteInfo    `json:"routes"`
	Models     []ModelInfo    `json:"models"`
	Bindings   []BindingInfo  `json:"bindings"`
	Views      []ViewInfo     `json:"views"`
	Middleware MiddlewareInfo `json:"middleware"`
}

type RouteInfo struct {
	Method     string   `json:"method"`
	URI        string   `json:"uri"`
	Name       string   `json:"name"`
	Action     string   `json:"action"`
	Middleware []string `json:"middleware"`
}

type ModelInfo struct {
	Name          string             `json:"name"`
	Namespace     string             `json:"namespace"`
	Filename      string             `json:"filename"`
	Properties    []PropertyInfo     `json:"properties"`
	Methods       []MethodInfo       `json:"methods"`
	Relationships []RelationshipInfo `json:"relationships"`
}

type PropertyInfo struct {
	Name       string `json:"name"`
	Visibility string `json:"visibility"`
	DocComment string `json:"doc_comment"`
}

type MethodInfo struct {
	Name string `json:"name"`
}

type RelationshipInfo struct {
	Name         string `json:"name"`
	Type         string `json:"type"`
	RelatedModel string `json:"related_model"`
}

type BindingInfo struct {
	Abstract string `json:"abstract"`
	Concrete string `json:"concrete"`
	Shared   bool   `json:"shared"`
}

type ViewInfo struct {
	Name  string `json:"name"`
	Path  string `json:"path"`
	Type  string `json:"type"`
	Class string `json:"class,omitempty"`
}

type MiddlewareInfo struct {
	Global  []string            `json:"global"`
	Groups  map[string][]string `json:"groups"`
	Aliases map[string]string   `json:"aliases"`
}

func (b *PHPBridge) InspectProject() (*ProjectStructure, error) {
	result, err := b.Call("ide.inspect", map[string]interface{}{})
	if err != nil {
		return nil, fmt.Errorf("failed to inspect project: %w", err)
	}

	jsonBytes, err := json.Marshal(result)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal result: %w", err)
	}

	var structure ProjectStructure
	if err := json.Unmarshal(jsonBytes, &structure); err != nil {
		return nil, fmt.Errorf("failed to unmarshal project structure: %w", err)
	}

	return &structure, nil
}

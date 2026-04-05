package predictive

import (
	"strings"
	"testing"
)

func TestLocalCompletions_PHP(t *testing.T) {
	lc := NewLocalCompletions()
	defer lc.Close()

	phpContent := []byte(`<?php

namespace App\Services;

class UserService
{
    private string $name;
    protected int $age;
    public float $score;
    
    public function __construct(string $name)
    {
        $this->name = $name;
    }
    
    public function getName(): string
    {
        return $this->name;
    }
    
    protected function validate(): bool
    {
        return true;
    }
    
    private function helper()
    {
        // private helper
    }
}

function globalFunction($param) {
    return $param * 2;
}
`)

	symbols := lc.GetCompletions("test.php", phpContent, 25, 10, "")

	// Verify we found the class
	found := make(map[string]bool)
	for _, s := range symbols {
		found[s.Name] = true
		t.Logf("Found symbol: %s (kind: %s, line: %d)", s.Name, s.Kind, s.Line)
	}

	expected := []string{"UserService", "getName", "validate", "helper", "__construct", "globalFunction"}
	for _, name := range expected {
		if !found[name] {
			t.Errorf("Expected to find symbol %q", name)
		}
	}

	// Test properties
	expectedProps := []string{"name", "age", "score"}
	for _, name := range expectedProps {
		if !found[name] {
			t.Errorf("Expected to find property %q", name)
		}
	}
}

func TestLocalCompletions_PHP_WithPrefix(t *testing.T) {
	lc := NewLocalCompletions()
	defer lc.Close()

	phpContent := []byte(`<?php

class Calculator
{
    public function add($a, $b) { return $a + $b; }
    public function subtract($a, $b) { return $a - $b; }
    public function multiply($a, $b) { return $a * $b; }
    public function addNumbers($nums) { return array_sum($nums); }
}
`)

	// Filter by prefix "add"
	symbols := lc.GetCompletions("test.php", phpContent, 8, 10, "add")

	if len(symbols) == 0 {
		t.Fatal("Expected to find symbols with prefix 'add'")
	}

	for _, s := range symbols {
		if !strings.HasPrefix(strings.ToLower(s.Name), "add") {
			t.Errorf("Symbol %q should start with 'add'", s.Name)
		}
	}

	// Should find "add" and "addNumbers"
	if len(symbols) < 2 {
		t.Errorf("Expected at least 2 symbols starting with 'add', got %d", len(symbols))
	}
}

func TestLocalCompletions_Go(t *testing.T) {
	lc := NewLocalCompletions()
	defer lc.Close()

	goContent := []byte(`package main

type Config struct {
	Name    string
	Port    int
	Enabled bool
}

type Handler interface {
	Handle(data []byte) error
}

func NewConfig(name string) *Config {
	return &Config{Name: name}
}

func (c *Config) Validate() error {
	return nil
}

var globalVar = "test"

const (
	MaxSize = 100
	MinSize = 10
)
`)

	symbols := lc.GetCompletions("test.go", goContent, 15, 10, "")

	found := make(map[string]string)
	for _, s := range symbols {
		found[s.Name] = s.Kind
		t.Logf("Found symbol: %s (kind: %s, line: %d)", s.Name, s.Kind, s.Line)
	}

	// Check types
	if kind, ok := found["Config"]; !ok || kind != "struct" {
		t.Errorf("Expected Config struct, got: %v", found["Config"])
	}

	if kind, ok := found["Handler"]; !ok || kind != "interface" {
		t.Errorf("Expected Handler interface, got: %v", found["Handler"])
	}

	// Check functions
	if kind, ok := found["NewConfig"]; !ok || kind != "function" {
		t.Errorf("Expected NewConfig function, got: %v", found["NewConfig"])
	}

	// Check methods
	if kind, ok := found["Validate"]; !ok || kind != "method" {
		t.Errorf("Expected Validate method, got: %v", found["Validate"])
	}
}

func TestLocalCompletions_TypeScript(t *testing.T) {
	lc := NewLocalCompletions()
	defer lc.Close()

	tsContent := []byte(`
export interface UserData {
    id: number;
    name: string;
}

export class UserService {
    private users: UserData[] = [];
    
    async getUser(id: number): Promise<UserData> {
        return this.users.find(u => u.id === id);
    }
    
    addUser(user: UserData): void {
        this.users.push(user);
    }
}

export const DEFAULT_USER: UserData = { id: 0, name: 'guest' };

export type UserID = number;

export function createUser(name: string): UserData {
    return { id: Date.now(), name };
}
`)

	symbols := lc.GetCompletions("test.ts", tsContent, 15, 10, "")

	found := make(map[string]string)
	for _, s := range symbols {
		found[s.Name] = s.Kind
		t.Logf("Found symbol: %s (kind: %s, line: %d)", s.Name, s.Kind, s.Line)
	}

	// Check interface
	if kind, ok := found["UserData"]; !ok || kind != "interface" {
		t.Errorf("Expected UserData interface, got: %v", found["UserData"])
	}

	// Check class
	if kind, ok := found["UserService"]; !ok || kind != "class" {
		t.Errorf("Expected UserService class, got: %v", found["UserService"])
	}

	// Check type alias
	if kind, ok := found["UserID"]; !ok || kind != "type" {
		t.Errorf("Expected UserID type, got: %v", found["UserID"])
	}

	// Check function
	if kind, ok := found["createUser"]; !ok || kind != "function" {
		t.Errorf("Expected createUser function, got: %v", found["createUser"])
	}

	// Check const
	if _, ok := found["DEFAULT_USER"]; !ok {
		t.Errorf("Expected DEFAULT_USER constant")
	}
}

func TestLocalCompletions_Python(t *testing.T) {
	lc := NewLocalCompletions()
	defer lc.Close()

	pyContent := []byte(`
class UserManager:
    def __init__(self, db):
        self.db = db
        
    def get_user(self, user_id):
        return self.db.find(user_id)
        
    def create_user(self, data):
        return self.db.insert(data)
        
def helper_function(x, y):
    return x + y

GLOBAL_CONST = 42
`)

	symbols := lc.GetCompletions("test.py", pyContent, 8, 10, "")

	found := make(map[string]string)
	for _, s := range symbols {
		found[s.Name] = s.Kind
		t.Logf("Found symbol: %s (kind: %s, line: %d)", s.Name, s.Kind, s.Line)
	}

	// Check class
	if kind, ok := found["UserManager"]; !ok || kind != "class" {
		t.Errorf("Expected UserManager class, got: %v", found["UserManager"])
	}

	// Check methods
	if kind, ok := found["get_user"]; !ok || kind != "method" {
		t.Errorf("Expected get_user method, got: %v", found["get_user"])
	}

	// Check function
	if kind, ok := found["helper_function"]; !ok || kind != "function" {
		t.Errorf("Expected helper_function function, got: %v", found["helper_function"])
	}

	// Check global variable
	if _, ok := found["GLOBAL_CONST"]; !ok {
		t.Errorf("Expected GLOBAL_CONST variable")
	}
}

func TestLocalCompletions_CaseInsensitivePrefix(t *testing.T) {
	lc := NewLocalCompletions()
	defer lc.Close()

	goContent := []byte(`package main

func CreateUser() {}
func createAdmin() {}
func UpdateUser() {}
`)

	// Search with lowercase prefix should find both Create functions
	symbols := lc.GetCompletions("test.go", goContent, 5, 5, "create")

	if len(symbols) != 2 {
		t.Errorf("Expected 2 symbols with prefix 'create', got %d", len(symbols))
		for _, s := range symbols {
			t.Logf("  Found: %s", s.Name)
		}
	}

	// Search with uppercase prefix
	symbols = lc.GetCompletions("test.go", goContent, 5, 5, "Create")

	if len(symbols) != 2 {
		t.Errorf("Expected 2 symbols with prefix 'Create', got %d", len(symbols))
	}
}

func TestLocalCompletions_DropsExactPrefixEcho(t *testing.T) {
	lc := NewLocalCompletions()
	defer lc.Close()

	goContent := []byte(`package main

type Config struct{}
type ConfigBuilder struct{}
func UpdateUser() {}
`)

	symbols := lc.GetCompletions("test.go", goContent, 5, 5, "Config")
	if len(symbols) == 0 {
		t.Fatal("expected non-empty completions for extended prefix")
	}

	for _, s := range symbols {
		if s.Name == "Config" {
			t.Fatalf("expected exact prefix echo to be filtered out, got %+v", s)
		}
	}

	if len(symbols) != 1 || symbols[0].Name != "ConfigBuilder" {
		t.Fatalf("expected only CreateUserFactory, got %+v", symbols)
	}
}

func TestLocalCompletions_EmptyFile(t *testing.T) {
	lc := NewLocalCompletions()
	defer lc.Close()

	symbols := lc.GetCompletions("test.php", []byte("<?php\n"), 1, 5, "")

	// Should return empty but not crash
	if symbols == nil {
		symbols = []LocalSymbol{}
	}

	t.Logf("Empty file returned %d symbols", len(symbols))
}

func TestLocalCompletions_JavaScriptClassMethods(t *testing.T) {
	lc := NewLocalCompletions()
	defer lc.Close()

	jsContent := []byte(`
class Calculator {
    constructor(base = 0) {
        this.base = base;
    }
    
    add(x) {
        return this.base + x;
    }
    
    subtract(x) {
        return this.base - x;
    }
    
    static create() {
        return new Calculator();
    }
}
`)

	symbols := lc.GetCompletions("test.js", jsContent, 10, 10, "")

	found := make(map[string]bool)
	for _, s := range symbols {
		found[s.Name] = true
		t.Logf("Found symbol: %s (kind: %s, line: %d)", s.Name, s.Kind, s.Line)
	}

	expected := []string{"Calculator", "add", "subtract", "create"}
	for _, name := range expected {
		if !found[name] {
			t.Errorf("Expected to find symbol %q", name)
		}
	}
}

package predictive

import (
	"testing"
)

type mockSymbolProvider struct {
	symbols     []SymbolInfo
	projectRoot string
}

func (m *mockSymbolProvider) QuerySymbols(query SymbolQuery) []SymbolInfo {
	var result []SymbolInfo
	for _, sym := range m.symbols {
		if query.Name != "" && sym.Name != query.Name {
			continue
		}
		if query.Kind != "" && sym.Kind != query.Kind {
			continue
		}
		if query.Language != "" && sym.FilePath != "" {
			continue
		}
		result = append(result, sym)
		if query.Limit > 0 && len(result) >= query.Limit {
			break
		}
	}
	return result
}

func (m *mockSymbolProvider) GetProjectRoot() string {
	return m.projectRoot
}

func TestEnhancedPlaceholderResolver_Basic(t *testing.T) {
	resolver := NewEnhancedPlaceholderResolver()

	tests := []struct {
		name     string
		template string
		ctx      *FileContext
		want     string
	}{
		{
			name:     "resolve controller from filename",
			template: "class $CONTROLLER",
			ctx: &FileContext{
				FilePath: "/app/Http/Controllers/UserController.php",
				Language: "php",
			},
			want: "class UserController",
		},
		{
			name:     "resolve model from controller",
			template: "use App\\Models\\$MODEL",
			ctx: &FileContext{
				FilePath:  "/app/Http/Controllers/UserController.php",
				ClassName: "UserController",
				Language:  "php",
			},
			want: "use App\\Models\\User",
		},
		{
			name:     "resolve table from model",
			template: "protected $table = '$TABLE'",
			ctx: &FileContext{
				FilePath:  "/app/Models/User.php",
				ClassName: "User",
				Language:  "php",
			},
			want: "protected $table = 'users'",
		},
		{
			name:     "resolve method placeholder",
			template: "public function $METHOD()",
			ctx: &FileContext{
				FilePath: "/app/Services/PaymentService.php",
				Language: "php",
			},
			want: "public function index()",
		},
		{
			name:     "resolve path from controller",
			template: "Route::get('/$PATH', ...)",
			ctx: &FileContext{
				FilePath:  "/app/Http/Controllers/UserController.php",
				ClassName: "UserController",
				Language:  "php",
			},
			want: "Route::get('/users', ...)",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := resolver.ResolvePlaceholders(tt.template, tt.ctx)
			if got != tt.want {
				t.Errorf("ResolvePlaceholders() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestEnhancedPlaceholderResolver_WithSymbolProvider(t *testing.T) {
	resolver := NewEnhancedPlaceholderResolver()

	mockProvider := &mockSymbolProvider{
		symbols: []SymbolInfo{
			{Name: "User", Kind: "class", FilePath: "/app/Models/User.php"},
			{Name: "Post", Kind: "class", FilePath: "/app/Models/Post.php"},
			{Name: "UserController", Kind: "class", FilePath: "/app/Http/Controllers/UserController.php"},
			{Name: "PostController", Kind: "class", FilePath: "/app/Http/Controllers/PostController.php"},
			{Name: "UserRequest", Kind: "class", FilePath: "/app/Http/Requests/UserRequest.php"},
			{Name: "AuthMiddleware", Kind: "class", FilePath: "/app/Http/Middleware/AuthMiddleware.php"},
			{Name: "UserCreated", Kind: "class", FilePath: "/app/Events/UserCreated.php"},
		},
		projectRoot: "/app",
	}

	resolver.SetSymbolProvider(mockProvider)

	tests := []struct {
		name     string
		template string
		ctx      *FileContext
		want     string
	}{
		{
			name:     "resolve controller from index",
			template: "class $CONTROLLER",
			ctx: &FileContext{
				FilePath: "/app/Models/User.php",
				Language: "php",
			},
			want: "class UserController",
		},
		{
			name:     "resolve model from index",
			template: "use $MODEL",
			ctx: &FileContext{
				FilePath:  "/app/Http/Controllers/UserController.php",
				ClassName: "UserController",
				Language:  "php",
			},
			want: "use User",
		},
		{
			name:     "resolve request from index",
			template: "public function store($REQUEST $request)",
			ctx: &FileContext{
				FilePath:  "/app/Http/Controllers/UserController.php",
				ClassName: "UserController",
				Language:  "php",
			},
			want: "public function store(UserRequest $request)",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := resolver.ResolvePlaceholders(tt.template, tt.ctx)
			if got != tt.want {
				t.Errorf("ResolvePlaceholders() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestEnhancedPlaceholderResolver_PluginResolvers(t *testing.T) {
	resolver := NewEnhancedPlaceholderResolver()

	resolver.RegisterPluginResolver("CUSTOM_VAR", func(ctx *FileContext, sp SymbolProvider) string {
		return "custom_value_from_plugin"
	})

	ctx := &FileContext{
		FilePath: "/app/test.php",
		Language: "php",
	}

	template := "echo '$CUSTOM_VAR'"
	want := "echo 'custom_value_from_plugin'"

	got := resolver.ResolvePlaceholders(template, ctx)
	if got != want {
		t.Errorf("ResolvePlaceholders() = %q, want %q", got, want)
	}
}

func TestFileRelationshipAnalyzer(t *testing.T) {
	analyzer := NewFileRelationshipAnalyzer()

	tests := []struct {
		name     string
		from     string
		to       string
		wantType string
	}{
		{
			name:     "User hasMany Posts",
			from:     "User",
			to:       "Post",
			wantType: "hasMany",
		},
		{
			name:     "Post belongsTo User",
			from:     "Post",
			to:       "User",
			wantType: "hasMany",
		},
		{
			name:     "Order hasMany OrderItems",
			from:     "Order",
			to:       "OrderItem",
			wantType: "hasMany",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := analyzer.InferRelationshipType(tt.from, tt.to)
			if got != tt.wantType {
				t.Errorf("InferRelationshipType(%q, %q) = %q, want %q", tt.from, tt.to, got, tt.wantType)
			}
		})
	}
}

func TestIsLikelyRelated(t *testing.T) {
	tests := []struct {
		model1 string
		model2 string
		want   bool
	}{
		{"User", "Post", true},
		{"User", "Comment", true},
		{"User", "Profile", true},
		{"Post", "Comment", true},
		{"Order", "OrderItem", true},
		{"Product", "ProductVariant", true},
		{"User", "Product", false},
		{"Post", "Order", false},
	}

	for _, tt := range tests {
		t.Run(tt.model1+"_"+tt.model2, func(t *testing.T) {
			got := isLikelyRelated(tt.model1, tt.model2)
			if got != tt.want {
				t.Errorf("isLikelyRelated(%q, %q) = %v, want %v", tt.model1, tt.model2, got, tt.want)
			}
		})
	}
}

func TestGetRelatedFilePath(t *testing.T) {
	tests := []struct {
		name       string
		current    string
		targetType string
		want       string
	}{
		{
			name:       "model to controller",
			current:    "/app/Models/User.php",
			targetType: "controller",
			want:       "/app/Http/Controllers/UserController.php",
		},
		{
			name:       "controller to model",
			current:    "/app/Http/Controllers/UserController.php",
			targetType: "model",
			want:       "/app/Models/User.php",
		},
		{
			name:       "controller to service",
			current:    "/app/Http/Controllers/UserController.php",
			targetType: "service",
			want:       "/app/Services/UserService.php",
		},
		{
			name:       "controller to request",
			current:    "/app/Http/Controllers/UserController.php",
			targetType: "request",
			want:       "/app/Http/Requests/UserRequest.php",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := GetRelatedFilePath(tt.current, tt.targetType, nil)
			if got != tt.want {
				t.Errorf("GetRelatedFilePath(%q, %q) = %q, want %q", tt.current, tt.targetType, got, tt.want)
			}
		})
	}
}

func TestStoreAdapter(t *testing.T) {
	adapter := NewStoreAdapter(nil, "/app")

	if adapter.GetProjectRoot() != "/app" {
		t.Errorf("GetProjectRoot() = %q, want /app", adapter.GetProjectRoot())
	}

	symbols := adapter.QuerySymbols(SymbolQuery{Name: "Test"})
	if symbols != nil {
		t.Errorf("QuerySymbols with nil store should return nil, got %v", symbols)
	}
}

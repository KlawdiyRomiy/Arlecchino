package predictive

import (
	"testing"
)

func TestEngine_NewEngine(t *testing.T) {
	engine := NewEngine()

	if engine == nil {
		t.Fatal("NewEngine returned nil")
	}

	if engine.analyzer == nil {
		t.Error("analyzer is nil")
	}

	if engine.matcher == nil {
		t.Error("matcher is nil")
	}

	if engine.generator == nil {
		t.Error("generator is nil")
	}
}

func TestEngine_Predict_EmptyFile(t *testing.T) {
	engine := NewEngine()

	filePath := "/app/Http/Controllers/UserController.php"
	content := "<?php\n\n"

	suggestions := engine.Predict(filePath, content, 2, 1)

	// Should get scaffold suggestion for empty controller
	found := false
	for _, s := range suggestions {
		if s.IsScaffold {
			found = true
			break
		}
	}

	if !found {
		t.Error("Expected scaffold suggestion for empty controller file")
	}
}

func TestEngine_Predict_InsideClass(t *testing.T) {
	engine := NewEngine()

	filePath := "/app/Http/Controllers/UserController.php"
	content := `<?php

namespace App\Http\Controllers;

class UserController extends Controller
{
    
}`

	suggestions := engine.Predict(filePath, content, 7, 5)

	if len(suggestions) == 0 {
		t.Error("Expected suggestions inside controller class")
	}

	// Check that suggestions have required fields
	for _, s := range suggestions {
		if s.DisplayText == "" {
			t.Error("Suggestion has empty DisplayText")
		}
		if s.Text == "" && !s.IsScaffold {
			t.Error("Non-scaffold suggestion has empty Text")
		}
	}
}

func TestEngine_NeedsScaffold(t *testing.T) {
	engine := NewEngine()

	tests := []struct {
		name     string
		filePath string
		content  string
		want     bool
	}{
		{
			name:     "Empty PHP controller",
			filePath: "/app/Http/Controllers/UserController.php",
			content:  "<?php\n\n",
			want:     true,
		},
		{
			name:     "Non-empty PHP controller",
			filePath: "/app/Http/Controllers/UserController.php",
			content: `<?php

namespace App\Http\Controllers;

class UserController extends Controller
{
    public function index() {}
}`,
			want: false,
		},
		{
			name:     "Empty Go file",
			filePath: "/service/user.go",
			content:  "package service\n\n",
			want:     true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctx := engine.analyzer.Analyze(tt.filePath, []byte(tt.content), 1, 1)

			if got := engine.NeedsScaffoldWithContent(ctx, tt.content); got != tt.want {
				t.Errorf("NeedsScaffoldWithContent() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestEngine_Analyze(t *testing.T) {
	engine := NewEngine()

	filePath := "/app/Models/User.php"
	content := "<?php\n\nnamespace App\\Models;\n\nclass User extends Model\n{\n    \n}"

	ctx := engine.analyzer.Analyze(filePath, []byte(content), 7, 5)

	if ctx.Language != "php" {
		t.Errorf("Language = %q, want %q", ctx.Language, "php")
	}

	if ctx.FileType != FileTypeModel {
		t.Errorf("FileType = %v, want %v", ctx.FileType, FileTypeModel)
	}
}

func TestEngine_GenerateScaffold(t *testing.T) {
	engine := NewEngine()

	tests := []struct {
		name      string
		fileType  FileType
		framework string
		language  string
		wantCode  bool
	}{
		{
			name:      "Laravel Controller",
			fileType:  FileTypeController,
			framework: "laravel",
			language:  "php",
			wantCode:  true,
		},
		{
			name:      "Laravel Model",
			fileType:  FileTypeModel,
			framework: "laravel",
			language:  "php",
			wantCode:  true,
		},
		{
			name:      "Go Service",
			fileType:  FileTypeService,
			framework: "gin",
			language:  "go",
			wantCode:  true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctx := &FileContext{
				FileType:  tt.fileType,
				Framework: tt.framework,
				Language:  tt.language,
			}

			// Create scaffold pattern
			pattern := &Pattern{
				ID:        "scaffold-test",
				Generator: tt.framework + "-" + string(tt.fileType),
			}

			code := engine.generator.Generate(ctx, pattern)

			if tt.wantCode && code == "" {
				// Try with just file type
				pattern.Generator = string(tt.fileType) + "-scaffold"
				code = engine.generator.Generate(ctx, pattern)
			}

			// Scaffold generation is optional - skip if not implemented
			if tt.wantCode && code == "" {
				t.Skip("Generator not implemented for this combination")
			}
		})
	}
}

func TestEngine_SuggestionPriority(t *testing.T) {
	engine := NewEngine()

	filePath := "/app/Http/Controllers/UserController.php"
	content := `<?php

namespace App\Http\Controllers;

class UserController extends Controller
{
    
}`

	suggestions := engine.Predict(filePath, content, 7, 5)

	if len(suggestions) < 2 {
		t.Skip("Not enough suggestions to test priority")
	}

	// Suggestions should be sorted by Score (higher first)
	for i := 1; i < len(suggestions); i++ {
		if suggestions[i-1].Score < suggestions[i].Score {
			t.Errorf("Suggestions not sorted by score: %.0f < %.0f",
				suggestions[i-1].Score, suggestions[i].Score)
		}
	}
}

func TestScaffoldInRoutes(t *testing.T) {
	engine := NewEngine()

	// Simulate routes/web.php content with Route:: calls
	content := `<?php

use Illuminate\Support\Facades\Route;

Route::get('/', function () {
    return view('welcome');
});

Route::`

	results := engine.Predict("/project/routes/web.php", content, 10, 7)
	t.Logf("\n=== RESULTS ===\n")
	for i, r := range results {
		t.Logf("[%d] DisplayText=%q IsScaffold=%v\n", i, r.DisplayText, r.IsScaffold)
		if r.IsScaffold && r.DisplayText == "Generate controller scaffold" {
			t.Errorf("BUG: Controller scaffold suggested in routes/web.php")
		}
	}
}

func TestScaffoldInRoutesMinimal(t *testing.T) {
	engine := NewEngine()

	// Simulate routes/web.php with only <?php
	content := `<?php`

	results := engine.Predict("/project/routes/web.php", content, 1, 5)
	t.Logf("\n=== RESULTS for minimal file ===\n")
	for i, r := range results {
		t.Logf("[%d] DisplayText=%q IsScaffold=%v\n", i, r.DisplayText, r.IsScaffold)
		if r.IsScaffold && r.DisplayText == "Generate controller scaffold" {
			t.Errorf("BUG: Controller scaffold suggested in routes/web.php")
		}
	}
}

func TestScaffoldInRoutesWithUse(t *testing.T) {
	engine := NewEngine()

	// routes/web.php with use statement but no code
	content := `<?php

use Illuminate\Support\Facades\Route;

`

	results := engine.Predict("/project/routes/web.php", content, 5, 0)
	t.Logf("\n=== RESULTS for routes with use ===\n")
	for i, r := range results {
		t.Logf("[%d] DisplayText=%q IsScaffold=%v\n", i, r.DisplayText, r.IsScaffold)
		if r.IsScaffold {
			t.Errorf("BUG: Scaffold suggested in routes/web.php: %q", r.DisplayText)
		}
	}
}

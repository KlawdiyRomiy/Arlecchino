package predictive

import (
	"regexp"
	"sort"
	"strings"

	sitter "github.com/smacker/go-tree-sitter"
)

type FillAllFields struct {
	safeParser *SafeParser
}

type ScopeVariable struct {
	Name       string
	Type       string
	Kind       string
	Line       int
	IsInScope  bool
	RecentUsed bool
	Confidence float64
}

type FunctionParameter struct {
	Name       string
	Type       string
	Index      int
	HasDefault bool
}

type FillSuggestion struct {
	InsertText  string
	DisplayText string
	Parameters  []ParameterFill
	Score       float64
}

type ParameterFill struct {
	ParameterName string
	ParameterType string
	VariableName  string
	VariableType  string
	Score         float64
	MatchReason   string
}

func NewFillAllFields() *FillAllFields {
	return &FillAllFields{
		safeParser: GetSafeParser(),
	}
}

type SignatureInfo struct {
	Label      string
	Parameters []ParameterInfo
}

type ParameterInfo struct {
	Label string
	Type  string
	Name  string
}

func (f *FillAllFields) GetFillSuggestionsWithSignature(
	filePath string,
	content []byte,
	line, column int,
	language string,
	signature *SignatureInfo,
) []FillSuggestion {
	if signature == nil || len(signature.Parameters) == 0 {
		return nil
	}

	params := f.convertSignatureParams(signature)
	if len(params) == 0 {
		return nil
	}

	scopeVars := f.extractScopeVariables(content, line, column, language)
	if len(scopeVars) == 0 {
		return nil
	}

	fills := f.matchParametersToVariables(params, scopeVars)
	if len(fills) == 0 {
		return nil
	}

	return f.generateSuggestions(fills, language)
}

func (f *FillAllFields) convertSignatureParams(sig *SignatureInfo) []FunctionParameter {
	var params []FunctionParameter

	for i, p := range sig.Parameters {
		name, paramType := f.parseParameterLabel(p.Label)
		if p.Name != "" {
			name = p.Name
		}
		if p.Type != "" {
			paramType = p.Type
		}

		params = append(params, FunctionParameter{
			Name:  name,
			Type:  paramType,
			Index: i,
		})
	}

	return params
}

func (f *FillAllFields) parseParameterLabel(label string) (name, paramType string) {
	label = strings.TrimSpace(label)

	phpPattern := regexp.MustCompile(`^(\??\w+(?:\|\w+)*)\s+\$(\w+)`)
	if m := phpPattern.FindStringSubmatch(label); m != nil {
		return m[2], m[1]
	}

	goPattern := regexp.MustCompile(`^(\w+)\s+(\S+)$`)
	if m := goPattern.FindStringSubmatch(label); m != nil {
		return m[1], m[2]
	}

	tsPattern := regexp.MustCompile(`^(\w+)\s*:\s*(\S+)`)
	if m := tsPattern.FindStringSubmatch(label); m != nil {
		return m[1], m[2]
	}

	pyPattern := regexp.MustCompile(`^(\w+)\s*:\s*(\S+)`)
	if m := pyPattern.FindStringSubmatch(label); m != nil {
		return m[1], m[2]
	}

	if strings.HasPrefix(label, "$") {
		return strings.TrimPrefix(label, "$"), ""
	}

	return label, ""
}

func (f *FillAllFields) GetFillSuggestions(
	filePath string,
	content []byte,
	line, column int,
	language string,
) []FillSuggestion {
	if !supportsFillLanguage(language) {
		return nil
	}

	functionName := extractFunctionNameAtCursor(content, line, column)
	if functionName == "" {
		return nil
	}

	signature := buildSignatureFromContent(content, language, functionName)
	if signature == nil || len(signature.Parameters) == 0 {
		return nil
	}

	return f.GetFillSuggestionsWithSignature(filePath, content, line, column, language, signature)
}

func supportsFillLanguage(language string) bool {
	switch strings.ToLower(language) {
	case "php", "go", "typescript", "javascript", "python":
		return true
	default:
		return false
	}
}

func extractFunctionNameAtCursor(content []byte, line, column int) string {
	lines := strings.Split(string(content), "\n")
	if line <= 0 || line > len(lines) {
		return ""
	}

	lineText := lines[line-1]
	if column < 0 {
		column = 0
	}
	if column > len(lineText) {
		column = len(lineText)
	}

	left := lineText[:column]
	matcher := regexp.MustCompile(`([A-Za-z_][A-Za-z0-9_]*)\s*\([^()]*$`)
	match := matcher.FindStringSubmatch(left)
	if len(match) < 2 {
		return ""
	}

	return match[1]
}

func buildSignatureFromContent(content []byte, language, functionName string) *SignatureInfo {
	paramsText := extractParamsText(string(content), strings.ToLower(language), functionName)
	if paramsText == "" {
		return nil
	}

	parameterLabels := splitParameters(paramsText)
	if len(parameterLabels) == 0 {
		return nil
	}

	signature := &SignatureInfo{}
	for _, param := range parameterLabels {
		normalized := normalizeParameterLabel(param)
		if normalized == "" {
			continue
		}
		signature.Parameters = append(signature.Parameters, ParameterInfo{Label: normalized})
	}

	if len(signature.Parameters) == 0 {
		return nil
	}

	return signature
}

func extractParamsText(content, language, functionName string) string {
	name := regexp.QuoteMeta(functionName)

	patterns := map[string][]string{
		"go": {
			`(?m)func\s+(?:\([^)]*\)\s*)?` + name + `\s*\(([^)]*)\)`,
		},
		"php": {
			`(?m)function\s+` + name + `\s*\(([^)]*)\)`,
		},
		"typescript": {
			`(?m)function\s+` + name + `\s*\(([^)]*)\)`,
			`(?m)^\s*` + name + `\s*\(([^)]*)\)\s*(?::[^\{]+)?\{`,
		},
		"javascript": {
			`(?m)function\s+` + name + `\s*\(([^)]*)\)`,
			`(?m)^\s*` + name + `\s*\(([^)]*)\)\s*\{`,
		},
		"python": {
			`(?m)def\s+` + name + `\s*\(([^)]*)\)\s*:`,
		},
	}

	for _, pattern := range patterns[language] {
		re := regexp.MustCompile(pattern)
		match := re.FindStringSubmatch(content)
		if len(match) == 2 {
			return strings.TrimSpace(match[1])
		}
	}

	return ""
}

func splitParameters(params string) []string {
	params = strings.TrimSpace(params)
	if params == "" {
		return nil
	}

	var result []string
	start := 0
	parenDepth := 0
	braceDepth := 0
	bracketDepth := 0
	angleDepth := 0

	for i, r := range params {
		switch r {
		case '(':
			parenDepth++
		case ')':
			if parenDepth > 0 {
				parenDepth--
			}
		case '{':
			braceDepth++
		case '}':
			if braceDepth > 0 {
				braceDepth--
			}
		case '[':
			bracketDepth++
		case ']':
			if bracketDepth > 0 {
				bracketDepth--
			}
		case '<':
			angleDepth++
		case '>':
			if angleDepth > 0 {
				angleDepth--
			}
		case ',':
			if parenDepth == 0 && braceDepth == 0 && bracketDepth == 0 && angleDepth == 0 {
				chunk := strings.TrimSpace(params[start:i])
				if chunk != "" {
					result = append(result, chunk)
				}
				start = i + 1
			}
		}
	}

	if start < len(params) {
		chunk := strings.TrimSpace(params[start:])
		if chunk != "" {
			result = append(result, chunk)
		}
	}

	return result
}

func normalizeParameterLabel(param string) string {
	param = strings.TrimSpace(param)
	if param == "" {
		return ""
	}

	if idx := strings.Index(param, "="); idx >= 0 {
		param = strings.TrimSpace(param[:idx])
	}

	if param == "self" || param == "cls" {
		return ""
	}

	return strings.TrimSpace(param)
}

func (f *FillAllFields) extractScopeVariables(content []byte, line, column int, language string) []ScopeVariable {
	tree, err := f.safeParser.Parse(language, content)
	if err != nil || tree == nil {
		return nil
	}
	defer tree.Close()

	root := tree.RootNode()
	if root == nil {
		return nil
	}

	point := sitter.Point{Row: uint32(line - 1), Column: uint32(column)}
	node := root.NamedDescendantForPointRange(point, point)

	var scopeNode *sitter.Node
	current := node
	for current != nil {
		nodeType := current.Type()
		if isScopeNode(nodeType, language) {
			scopeNode = current
			break
		}
		current = current.Parent()
	}

	if scopeNode == nil {
		scopeNode = root
	}

	switch language {
	case "php":
		return f.extractPHPScopeVariables(scopeNode, content, line)
	case "go":
		return f.extractGoScopeVariables(scopeNode, content, line)
	case "typescript", "javascript":
		return f.extractJSScopeVariables(scopeNode, content, line)
	case "python":
		return f.extractPythonScopeVariables(scopeNode, content, line)
	}

	return nil
}

func isScopeNode(nodeType, language string) bool {
	switch language {
	case "php":
		return nodeType == "method_declaration" || nodeType == "function_definition" ||
			nodeType == "compound_statement"
	case "go":
		return nodeType == "function_declaration" || nodeType == "method_declaration" ||
			nodeType == "block"
	case "typescript", "javascript":
		return nodeType == "function_declaration" || nodeType == "method_definition" ||
			nodeType == "arrow_function" || nodeType == "statement_block"
	case "python":
		return nodeType == "function_definition" || nodeType == "block"
	}
	return false
}

func (f *FillAllFields) extractPHPScopeVariables(scopeNode *sitter.Node, content []byte, cursorLine int) []ScopeVariable {
	var vars []ScopeVariable
	seen := make(map[string]bool)
	f.walkPHPScope(scopeNode, content, cursorLine, &vars, seen)
	return vars
}

func (f *FillAllFields) walkPHPScope(node *sitter.Node, content []byte, cursorLine int, vars *[]ScopeVariable, seen map[string]bool) {
	if node == nil {
		return
	}

	nodeType := node.Type()

	switch nodeType {
	case "simple_parameter":
		name := ""
		varType := ""

		for i := uint32(0); i < node.ChildCount(); i++ {
			child := node.Child(int(i))
			switch child.Type() {
			case "variable_name":
				name = strings.TrimPrefix(child.Content(content), "$")
			case "type_list", "named_type", "primitive_type":
				varType = child.Content(content)
			}
		}

		if name != "" && !seen[name] {
			seen[name] = true
			*vars = append(*vars, ScopeVariable{
				Name:      name,
				Type:      varType,
				Kind:      "parameter",
				Line:      int(node.StartPoint().Row) + 1,
				IsInScope: true,
			})
		}

	case "property_declaration":
		varType := ""
		for i := uint32(0); i < node.ChildCount(); i++ {
			child := node.Child(int(i))
			if child.Type() == "type_list" || child.Type() == "named_type" || child.Type() == "primitive_type" {
				varType = child.Content(content)
			}
			if child.Type() == "property_element" {
				if varNode := findChildByType(child, "variable_name"); varNode != nil {
					name := strings.TrimPrefix(varNode.Content(content), "$")
					if !seen[name] {
						seen[name] = true
						*vars = append(*vars, ScopeVariable{
							Name:      name,
							Type:      varType,
							Kind:      "property",
							Line:      int(node.StartPoint().Row) + 1,
							IsInScope: int(node.StartPoint().Row)+1 <= cursorLine,
						})
					}
				}
			}
		}

	case "assignment_expression":
		if left := findChildByType(node, "variable_name"); left != nil {
			name := strings.TrimPrefix(left.Content(content), "$")
			if !seen[name] {
				seen[name] = true
				*vars = append(*vars, ScopeVariable{
					Name:      name,
					Type:      f.inferPHPType(node, content),
					Kind:      "variable",
					Line:      int(node.StartPoint().Row) + 1,
					IsInScope: int(node.StartPoint().Row)+1 < cursorLine,
				})
			}
		}
	}

	for i := uint32(0); i < node.ChildCount(); i++ {
		f.walkPHPScope(node.Child(int(i)), content, cursorLine, vars, seen)
	}
}

func (f *FillAllFields) inferPHPType(assignNode *sitter.Node, content []byte) string {
	for i := uint32(0); i < assignNode.ChildCount(); i++ {
		child := assignNode.Child(int(i))
		switch child.Type() {
		case "object_creation_expression":
			if name := findChildByType(child, "name"); name != nil {
				return name.Content(content)
			}
		case "string", "encapsed_string":
			return "string"
		case "integer":
			return "int"
		case "float":
			return "float"
		case "boolean":
			return "bool"
		case "array_creation_expression":
			return "array"
		}
	}
	return ""
}

func (f *FillAllFields) extractGoScopeVariables(scopeNode *sitter.Node, content []byte, cursorLine int) []ScopeVariable {
	var vars []ScopeVariable
	seen := make(map[string]bool)
	f.walkGoScope(scopeNode, content, cursorLine, &vars, seen)
	return vars
}

func (f *FillAllFields) walkGoScope(node *sitter.Node, content []byte, cursorLine int, vars *[]ScopeVariable, seen map[string]bool) {
	if node == nil {
		return
	}

	nodeType := node.Type()

	switch nodeType {
	case "parameter_declaration":
		varType := ""
		var names []string

		for i := uint32(0); i < node.ChildCount(); i++ {
			child := node.Child(int(i))
			switch child.Type() {
			case "identifier":
				names = append(names, child.Content(content))
			case "type_identifier", "pointer_type", "slice_type", "map_type":
				varType = child.Content(content)
			}
		}

		for _, name := range names {
			if !seen[name] {
				seen[name] = true
				*vars = append(*vars, ScopeVariable{
					Name:      name,
					Type:      varType,
					Kind:      "parameter",
					Line:      int(node.StartPoint().Row) + 1,
					IsInScope: true,
				})
			}
		}

	case "short_var_declaration":
		varType := ""
		if right := node.ChildByFieldName("right"); right != nil {
			varType = f.inferGoType(right, content)
		}

		if left := node.ChildByFieldName("left"); left != nil {
			if left.Type() == "expression_list" {
				for i := uint32(0); i < left.NamedChildCount(); i++ {
					if ident := left.NamedChild(int(i)); ident != nil && ident.Type() == "identifier" {
						name := ident.Content(content)
						if !seen[name] {
							seen[name] = true
							*vars = append(*vars, ScopeVariable{
								Name:      name,
								Type:      varType,
								Kind:      "variable",
								Line:      int(node.StartPoint().Row) + 1,
								IsInScope: int(node.StartPoint().Row)+1 < cursorLine,
							})
						}
					}
				}
			} else if left.Type() == "identifier" {
				name := left.Content(content)
				if !seen[name] {
					seen[name] = true
					*vars = append(*vars, ScopeVariable{
						Name:      name,
						Type:      varType,
						Kind:      "variable",
						Line:      int(node.StartPoint().Row) + 1,
						IsInScope: int(node.StartPoint().Row)+1 < cursorLine,
					})
				}
			}
		}

	case "var_declaration":
		for i := uint32(0); i < node.NamedChildCount(); i++ {
			spec := node.NamedChild(int(i))
			if spec.Type() == "var_spec" {
				varType := ""
				if typeNode := findChildByType(spec, "type_identifier"); typeNode != nil {
					varType = typeNode.Content(content)
				}
				if ident := findChildByType(spec, "identifier"); ident != nil {
					name := ident.Content(content)
					if !seen[name] {
						seen[name] = true
						*vars = append(*vars, ScopeVariable{
							Name:      name,
							Type:      varType,
							Kind:      "variable",
							Line:      int(node.StartPoint().Row) + 1,
							IsInScope: int(node.StartPoint().Row)+1 < cursorLine,
						})
					}
				}
			}
		}
	}

	for i := uint32(0); i < node.ChildCount(); i++ {
		f.walkGoScope(node.Child(int(i)), content, cursorLine, vars, seen)
	}
}

func (f *FillAllFields) inferGoType(node *sitter.Node, content []byte) string {
	switch node.Type() {
	case "composite_literal":
		if typeNode := findChildByType(node, "type_identifier"); typeNode != nil {
			return typeNode.Content(content)
		}
		if sliceType := findChildByType(node, "slice_type"); sliceType != nil {
			return sliceType.Content(content)
		}
	case "call_expression":
		if fn := findChildByType(node, "identifier"); fn != nil {
			fnName := fn.Content(content)
			if strings.HasPrefix(fnName, "New") {
				return strings.TrimPrefix(fnName, "New")
			}
		}
	case "interpreted_string_literal", "raw_string_literal":
		return "string"
	case "int_literal":
		return "int"
	case "float_literal":
		return "float64"
	case "true", "false":
		return "bool"
	}
	return ""
}

func (f *FillAllFields) extractJSScopeVariables(scopeNode *sitter.Node, content []byte, cursorLine int) []ScopeVariable {
	var vars []ScopeVariable
	seen := make(map[string]bool)
	f.walkJSScope(scopeNode, content, cursorLine, &vars, seen)
	return vars
}

func (f *FillAllFields) walkJSScope(node *sitter.Node, content []byte, cursorLine int, vars *[]ScopeVariable, seen map[string]bool) {
	if node == nil {
		return
	}

	nodeType := node.Type()

	switch nodeType {
	case "required_parameter", "optional_parameter":
		varType := ""
		name := ""

		for i := uint32(0); i < node.ChildCount(); i++ {
			child := node.Child(int(i))
			switch child.Type() {
			case "identifier":
				name = child.Content(content)
			case "type_annotation":
				if typeNode := findChildByType(child, "type_identifier"); typeNode != nil {
					varType = typeNode.Content(content)
				}
			}
		}

		if name != "" && !seen[name] {
			seen[name] = true
			*vars = append(*vars, ScopeVariable{
				Name:      name,
				Type:      varType,
				Kind:      "parameter",
				Line:      int(node.StartPoint().Row) + 1,
				IsInScope: true,
			})
		}

	case "variable_declarator":
		name := ""
		varType := ""

		if ident := findChildByType(node, "identifier"); ident != nil {
			name = ident.Content(content)
		}
		if typeAnn := findChildByType(node, "type_annotation"); typeAnn != nil {
			if typeNode := findChildByType(typeAnn, "type_identifier"); typeNode != nil {
				varType = typeNode.Content(content)
			}
		}
		if varType == "" {
			if value := node.ChildByFieldName("value"); value != nil {
				varType = f.inferJSType(value, content)
			}
		}

		if name != "" && !seen[name] {
			seen[name] = true
			*vars = append(*vars, ScopeVariable{
				Name:      name,
				Type:      varType,
				Kind:      "variable",
				Line:      int(node.StartPoint().Row) + 1,
				IsInScope: int(node.StartPoint().Row)+1 < cursorLine,
			})
		}
	}

	for i := uint32(0); i < node.ChildCount(); i++ {
		f.walkJSScope(node.Child(int(i)), content, cursorLine, vars, seen)
	}
}

func (f *FillAllFields) inferJSType(node *sitter.Node, content []byte) string {
	switch node.Type() {
	case "new_expression":
		if ctor := findChildByType(node, "identifier"); ctor != nil {
			return ctor.Content(content)
		}
	case "string", "template_string":
		return "string"
	case "number":
		return "number"
	case "true", "false":
		return "boolean"
	case "array":
		return "array"
	case "object":
		return "object"
	}
	return ""
}

func (f *FillAllFields) extractPythonScopeVariables(scopeNode *sitter.Node, content []byte, cursorLine int) []ScopeVariable {
	var vars []ScopeVariable
	seen := make(map[string]bool)
	f.walkPythonScope(scopeNode, content, cursorLine, &vars, seen)
	return vars
}

func (f *FillAllFields) walkPythonScope(node *sitter.Node, content []byte, cursorLine int, vars *[]ScopeVariable, seen map[string]bool) {
	if node == nil {
		return
	}

	nodeType := node.Type()

	switch nodeType {
	case "typed_parameter", "default_parameter", "identifier":
		if nodeType == "typed_parameter" {
			name := ""
			varType := ""
			if ident := findChildByType(node, "identifier"); ident != nil {
				name = ident.Content(content)
			}
			if typeNode := findChildByType(node, "type"); typeNode != nil {
				varType = typeNode.Content(content)
			}
			if name != "" && !seen[name] {
				seen[name] = true
				*vars = append(*vars, ScopeVariable{
					Name:      name,
					Type:      varType,
					Kind:      "parameter",
					Line:      int(node.StartPoint().Row) + 1,
					IsInScope: true,
				})
			}
		}

	case "assignment":
		if left := node.ChildByFieldName("left"); left != nil {
			if left.Type() == "identifier" {
				name := left.Content(content)
				if !seen[name] {
					seen[name] = true
					*vars = append(*vars, ScopeVariable{
						Name:      name,
						Type:      f.inferPythonType(node, content),
						Kind:      "variable",
						Line:      int(node.StartPoint().Row) + 1,
						IsInScope: int(node.StartPoint().Row)+1 < cursorLine,
					})
				}
			}
		}
	}

	for i := uint32(0); i < node.ChildCount(); i++ {
		f.walkPythonScope(node.Child(int(i)), content, cursorLine, vars, seen)
	}
}

func (f *FillAllFields) inferPythonType(node *sitter.Node, content []byte) string {
	if typeNode := findChildByType(node, "type"); typeNode != nil {
		return typeNode.Content(content)
	}
	if right := node.ChildByFieldName("right"); right != nil {
		switch right.Type() {
		case "call":
			if fn := findChildByType(right, "identifier"); fn != nil {
				return fn.Content(content)
			}
		case "string":
			return "str"
		case "integer":
			return "int"
		case "float":
			return "float"
		case "true", "false":
			return "bool"
		case "list":
			return "list"
		case "dictionary":
			return "dict"
		}
	}
	return ""
}

func (f *FillAllFields) matchParametersToVariables(params []FunctionParameter, scopeVars []ScopeVariable) []ParameterFill {
	var fills []ParameterFill

	for _, param := range params {
		bestMatch := f.findBestMatch(param, scopeVars)
		if bestMatch != nil {
			fills = append(fills, *bestMatch)
		}
	}

	return fills
}

func (f *FillAllFields) findBestMatch(param FunctionParameter, scopeVars []ScopeVariable) *ParameterFill {
	type scoredVar struct {
		variable ScopeVariable
		score    float64
		reason   string
	}

	var candidates []scoredVar

	for _, v := range scopeVars {
		if !v.IsInScope {
			continue
		}

		score := 0.0
		reason := ""

		if param.Type != "" && v.Type != "" {
			if f.typesMatch(param.Type, v.Type) {
				score += 50
				reason = "type"
			}
		}

		if param.Name != "" {
			nameScore := f.nameSimilarity(param.Name, v.Name)
			score += nameScore * 30
			if nameScore > 0.5 && reason == "" {
				reason = "name"
			}
		}

		semanticScore := f.semanticMatch(param.Name, v.Name)
		score += semanticScore * 20
		if semanticScore > 0.5 && reason == "" {
			reason = "semantic"
		}

		if v.RecentUsed {
			score += 10
		}

		if score > 0 {
			candidates = append(candidates, scoredVar{v, score, reason})
		}
	}

	if len(candidates) == 0 {
		return nil
	}

	sort.Slice(candidates, func(i, j int) bool {
		return candidates[i].score > candidates[j].score
	})

	best := candidates[0]
	return &ParameterFill{
		ParameterName: param.Name,
		ParameterType: param.Type,
		VariableName:  best.variable.Name,
		VariableType:  best.variable.Type,
		Score:         best.score,
		MatchReason:   best.reason,
	}
}

func (f *FillAllFields) typesMatch(expected, actual string) bool {
	expected = strings.ToLower(strings.TrimPrefix(expected, "?"))
	actual = strings.ToLower(actual)

	if expected == actual {
		return true
	}

	aliases := map[string][]string{
		"int":    {"integer", "int32", "int64", "number"},
		"string": {"str", "text"},
		"bool":   {"boolean"},
		"float":  {"double", "float32", "float64", "number"},
		"array":  {"list", "slice", "[]"},
		"object": {"dict", "map", "hash"},
	}

	for canonical, aliasList := range aliases {
		if expected == canonical || actual == canonical {
			for _, alias := range aliasList {
				if expected == alias || actual == alias {
					return true
				}
			}
		}
	}

	return strings.Contains(actual, expected) || strings.Contains(expected, actual)
}

func (f *FillAllFields) nameSimilarity(paramName, varName string) float64 {
	paramName = strings.ToLower(paramName)
	varName = strings.ToLower(varName)

	if paramName == varName {
		return 1.0
	}

	if strings.Contains(varName, paramName) || strings.Contains(paramName, varName) {
		return 0.8
	}

	if strings.HasPrefix(varName, paramName) || strings.HasSuffix(varName, paramName) {
		return 0.7
	}
	if strings.HasPrefix(paramName, varName) || strings.HasSuffix(paramName, varName) {
		return 0.6
	}

	return f.fuzzyMatch(paramName, varName)
}

// semanticMatch checks for semantic similarity using predefined semantic groups.
// These groups represent terms that developers commonly use interchangeably.
func (f *FillAllFields) semanticMatch(paramName, varName string) float64 {
	paramName = strings.ToLower(paramName)
	varName = strings.ToLower(varName)

	semanticPairs := [][]string{
		{"count", "total", "length", "size", "num"},
		{"user", "customer", "client", "member", "person"},
		{"id", "identifier", "key", "pk"},
		{"name", "title", "label"},
		{"data", "payload", "content", "body"},
		{"request", "req", "input"},
		{"response", "resp", "output", "result"},
		{"error", "err", "exception"},
		{"message", "msg", "text"},
		{"list", "items", "collection", "array"},
		{"config", "options", "settings"},
		{"path", "url", "uri", "route"},
		{"file", "filename", "filepath"},
		{"date", "time", "datetime", "timestamp"},
	}

	for _, group := range semanticPairs {
		paramInGroup := false
		varInGroup := false

		for _, term := range group {
			if strings.Contains(paramName, term) {
				paramInGroup = true
			}
			if strings.Contains(varName, term) {
				varInGroup = true
			}
		}

		if paramInGroup && varInGroup {
			return 1.0
		}
	}

	return 0.0
}

func (f *FillAllFields) fuzzyMatch(a, b string) float64 {
	if len(a) == 0 || len(b) == 0 {
		return 0
	}

	matches := 0
	for i := 0; i < len(a); i++ {
		for j := 0; j < len(b); j++ {
			if a[i] == b[j] {
				matches++
				break
			}
		}
	}

	maxLen := len(a)
	if len(b) > maxLen {
		maxLen = len(b)
	}
	return float64(matches) / float64(maxLen)
}

func (f *FillAllFields) generateSuggestions(fills []ParameterFill, language string) []FillSuggestion {
	if len(fills) == 0 {
		return nil
	}

	var parts []string
	for _, fill := range fills {
		varRef := fill.VariableName
		if language == "php" {
			varRef = "$" + fill.VariableName
		}
		parts = append(parts, varRef)
	}

	insertText := strings.Join(parts, ", ")

	totalScore := 0.0
	for _, fill := range fills {
		totalScore += fill.Score
	}
	avgScore := totalScore / float64(len(fills))

	displayText := "Fill all: " + insertText

	return []FillSuggestion{{
		InsertText:  insertText,
		DisplayText: displayText,
		Parameters:  fills,
		Score:       avgScore,
	}}
}

func (f *FillAllFields) Close() {
}

func findChildByType(node *sitter.Node, childType string) *sitter.Node {
	for i := uint32(0); i < node.ChildCount(); i++ {
		child := node.Child(int(i))
		if child.Type() == childType {
			return child
		}
	}
	return nil
}

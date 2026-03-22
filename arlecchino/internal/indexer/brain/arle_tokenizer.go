package brain

import (
	"encoding/json"
	"os"
	"strings"
	"sync"
)

type ArleTokenizer struct {
	mu         sync.RWMutex
	vocab      map[string]int
	invVocab   map[int]string
	merges     []TokenPair
	byteLevel  bool
	padID      int
	unkID      int
	bosID      int
	eosID      int
	langTokens map[string]int
}

type TokenPair struct {
	First  string
	Second string
	Result string
}

// HuggingFace tokenizer JSON format
type hfTokenizer struct {
	Model struct {
		Vocab map[string]int `json:"vocab"`
	} `json:"model"`
	AddedTokens []struct {
		ID      int    `json:"id"`
		Content string `json:"content"`
	} `json:"added_tokens"`
	PreTokenizer struct {
		Type string `json:"type"`
	} `json:"pre_tokenizer"`
}

func NewArleTokenizer(vocabPath string) (*ArleTokenizer, error) {
	t := &ArleTokenizer{
		vocab:      make(map[string]int),
		invVocab:   make(map[int]string),
		merges:     make([]TokenPair, 0),
		padID:      0,
		unkID:      1,
		bosID:      2,
		eosID:      3,
		langTokens: make(map[string]int),
	}

	if vocabPath != "" {
		if err := t.loadVocab(vocabPath); err != nil {
			return t, nil
		}
	}

	if len(t.vocab) == 0 {
		t.initDefaultVocab()
	}

	return t, nil
}

func (t *ArleTokenizer) loadVocab(path string) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}

	// Try HuggingFace JSON format first
	if strings.HasSuffix(path, ".json") {
		return t.loadHuggingFaceVocab(data)
	}

	// Fallback: simple text format (one token per line)
	lines := strings.Split(string(data), "\n")
	for i, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		t.vocab[line] = i
		t.invVocab[i] = line
	}

	return nil
}

func (t *ArleTokenizer) loadHuggingFaceVocab(data []byte) error {
	var hf hfTokenizer
	if err := json.Unmarshal(data, &hf); err != nil {
		return err
	}

	// Check if ByteLevel pre-tokenizer
	t.byteLevel = hf.PreTokenizer.Type == "ByteLevel"

	// Load vocab from model
	for token, id := range hf.Model.Vocab {
		t.vocab[token] = id
		t.invVocab[id] = token
	}

	// Set special token IDs from added_tokens
	for _, at := range hf.AddedTokens {
		switch at.Content {
		case "<PAD>":
			t.padID = at.ID
		case "<UNK>":
			t.unkID = at.ID
		case "<BOS>":
			t.bosID = at.ID
		case "<EOS>":
			t.eosID = at.ID
		}
	}

	return nil
}

func (t *ArleTokenizer) initDefaultVocab() {
	baseTokens := []string{
		"<PAD>", "<UNK>", "<BOS>", "<EOS>",
		"<PYTHON>", "<JAVASCRIPT>", "<TYPESCRIPT>", "<JAVA>", "<CSHARP>",
		"<CPP>", "<C>", "<GO>", "<RUST>", "<PHP>",
		"<RUBY>", "<SWIFT>", "<KOTLIN>", "<SCALA>", "<SHELL>",
		"<LUA>", "<R>", "<PERL>", "<HASKELL>", "<CLOJURE>",
		"<ELIXIR>", "<ERLANG>", "<JULIA>", "<DART>", "<GROOVY>",
		"<POWERSHELL>", "<OBJECTIVEC>",
		"<FSHARP>", "<OCAML>", "<FORTRAN>", "<COBOL>", "<ADA>",
		"<PROLOG>", "<LISP>", "<SCHEME>", "<RACKET>", "<COMMONLISP>",
		"<ASSEMBLY>", "<VHDL>", "<VERILOG>", "<ZIG>", "<NIM>", "<CRYSTAL>",
		"<JSON>", "<YAML>", "<TOML>", "<XML>", "<MARKDOWN>", "<DOCKERFILE>",
		"<SQL>", "<HTML>",
		" ", "\t", "\n",
	}

	langTokenIdx := 4
	langs := []string{
		"python", "javascript", "typescript", "java", "csharp",
		"cpp", "c", "go", "rust", "php",
		"ruby", "swift", "kotlin", "scala", "shell",
		"lua", "r", "perl", "haskell", "clojure",
		"elixir", "erlang", "julia", "dart", "groovy",
		"powershell", "objectivec",
		"fsharp", "ocaml", "fortran", "cobol", "ada",
		"prolog", "lisp", "scheme", "racket", "commonlisp",
		"assembly", "vhdl", "verilog", "zig", "nim", "crystal",
		"json", "yaml", "toml", "xml", "markdown", "dockerfile",
		"sql", "html",
	}
	for i, lang := range langs {
		t.langTokens[lang] = langTokenIdx + i
	}
	t.langTokens["typescriptreact"] = t.langTokens["typescript"]
	t.langTokens["javascriptreact"] = t.langTokens["javascript"]
	t.langTokens["bash"] = t.langTokens["shell"]
	t.langTokens["sh"] = t.langTokens["shell"]
	t.langTokens["zsh"] = t.langTokens["shell"]
	t.langTokens["cs"] = t.langTokens["csharp"]
	t.langTokens["c++"] = t.langTokens["cpp"]
	t.langTokens["objective-c"] = t.langTokens["objectivec"]
	t.langTokens["f#"] = t.langTokens["fsharp"]
	t.langTokens["common-lisp"] = t.langTokens["commonlisp"]
	t.langTokens["md"] = t.langTokens["markdown"]
	t.langTokens["yml"] = t.langTokens["yaml"]

	for i := 0; i < 256; i++ {
		baseTokens = append(baseTokens, string(rune(i)))
	}

	keywords := []string{
		"function", "class", "interface", "public", "private", "protected",
		"static", "const", "var", "let", "if", "else", "for", "while",
		"return", "import", "export", "from", "package", "func", "type",
		"struct", "def", "self", "this", "new", "try", "catch", "throw",
		"async", "await", "extends", "implements", "interface", "abstract",
	}
	baseTokens = append(baseTokens, keywords...)

	for i, token := range baseTokens {
		t.vocab[token] = i
		t.invVocab[i] = token
	}
}

// ByteLevel encoding table (GPT-2 style)
var byteToChar = func() map[byte]rune {
	m := make(map[byte]rune)

	for i := 33; i <= 126; i++ {
		m[byte(i)] = rune(i)
	}
	for i := 161; i <= 172; i++ {
		m[byte(i)] = rune(i)
	}
	for i := 174; i <= 255; i++ {
		m[byte(i)] = rune(i)
	}

	offset := 256
	for i := 0; i < 256; i++ {
		if _, ok := m[byte(i)]; !ok {
			m[byte(i)] = rune(offset)
			offset++
		}
	}
	return m
}()

var charToByte = func() map[rune]byte {
	m := make(map[rune]byte)
	for b, c := range byteToChar {
		m[c] = b
	}
	return m
}()

func byteLevelEncode(text string) string {
	var sb strings.Builder
	for i := 0; i < len(text); i++ {
		sb.WriteRune(byteToChar[text[i]])
	}
	return sb.String()
}

func byteLevelDecode(text string) string {
	var result []byte
	for _, r := range text {
		if b, ok := charToByte[r]; ok {
			result = append(result, b)
		}
	}
	return string(result)
}

func (t *ArleTokenizer) Tokenize(text string, maxTokens int) []int {
	t.mu.RLock()
	defer t.mu.RUnlock()

	if len(text) == 0 {
		return nil
	}

	if maxTokens > 0 && len(text) > maxTokens*4 {
		text = text[len(text)-maxTokens*4:]
	}

	var tokens []int

	if t.byteLevel && len(t.vocab) > 1000 {
		tokens = t.tokenizeBPE(text, maxTokens)
	} else {
		tokens = t.tokenizeSimple(text)
	}

	if maxTokens > 0 && len(tokens) > maxTokens {
		tokens = tokens[len(tokens)-maxTokens:]
	}

	return tokens
}

func (t *ArleTokenizer) tokenizeSimple(text string) []int {
	tokens := make([]int, 0, len(text))
	for _, r := range text {
		s := string(r)
		if id, ok := t.vocab[s]; ok {
			tokens = append(tokens, id)
		} else {
			tokens = append(tokens, t.unkID)
		}
	}
	return tokens
}

func (t *ArleTokenizer) tokenizeBPE(text string, maxTokens int) []int {
	encoded := byteLevelEncode(text)
	words := t.splitIntoWords(encoded)

	var tokens []int
	for _, word := range words {
		wordTokens := t.bpeEncode(word)
		tokens = append(tokens, wordTokens...)
	}
	return tokens
}

func (t *ArleTokenizer) splitIntoWords(text string) []string {
	var words []string
	var current strings.Builder

	for _, r := range text {
		if r == 'Ġ' {
			if current.Len() > 0 {
				words = append(words, current.String())
				current.Reset()
			}
			current.WriteRune(r)
		} else {
			current.WriteRune(r)
		}
	}

	if current.Len() > 0 {
		words = append(words, current.String())
	}

	return words
}

func (t *ArleTokenizer) bpeEncode(word string) []int {
	if id, ok := t.vocab[word]; ok {
		return []int{id}
	}

	chars := []string{}
	for _, r := range word {
		chars = append(chars, string(r))
	}

	for len(chars) > 1 {
		bestPair := -1
		bestIdx := -1

		for i := 0; i < len(chars)-1; i++ {
			merged := chars[i] + chars[i+1]
			if id, ok := t.vocab[merged]; ok {
				if bestPair == -1 || id < bestPair {
					bestPair = id
					bestIdx = i
				}
			}
		}

		if bestIdx == -1 {
			break
		}

		newChars := make([]string, 0, len(chars)-1)
		newChars = append(newChars, chars[:bestIdx]...)
		newChars = append(newChars, chars[bestIdx]+chars[bestIdx+1])
		newChars = append(newChars, chars[bestIdx+2:]...)
		chars = newChars
	}

	tokens := make([]int, 0, len(chars))
	for _, c := range chars {
		if id, ok := t.vocab[c]; ok {
			tokens = append(tokens, id)
		} else {
			tokens = append(tokens, t.unkID)
		}
	}

	return tokens
}

func (t *ArleTokenizer) Detokenize(tokens []int) string {
	t.mu.RLock()
	defer t.mu.RUnlock()

	var sb strings.Builder
	for _, id := range tokens {
		if s, ok := t.invVocab[id]; ok {
			if s != "<PAD>" && s != "<UNK>" && s != "<BOS>" && s != "<EOS>" && s != "<MASK>" {
				sb.WriteString(s)
			}
		}
	}

	result := sb.String()
	if t.byteLevel {
		result = byteLevelDecode(result)
	}

	return result
}

func (t *ArleTokenizer) VocabSize() int {
	t.mu.RLock()
	defer t.mu.RUnlock()
	return len(t.vocab)
}

func (t *ArleTokenizer) Encode(text string) []int {
	return t.Tokenize(text, 0)
}

func (t *ArleTokenizer) Decode(tokens []int) string {
	return t.Detokenize(tokens)
}

func (t *ArleTokenizer) GetLanguageToken(lang string) int {
	t.mu.RLock()
	defer t.mu.RUnlock()

	lang = strings.ToLower(lang)
	if id, ok := t.langTokens[lang]; ok {
		return id
	}
	return t.unkID
}

func (t *ArleTokenizer) TokenizeWithLanguage(text, lang string, maxLen int) []int {
	langToken := t.GetLanguageToken(lang)
	tokens := t.Tokenize(text, maxLen-1)
	return append([]int{langToken}, tokens...)
}

func (t *ArleTokenizer) HasLanguageToken(lang string) bool {
	t.mu.RLock()
	defer t.mu.RUnlock()
	_, ok := t.langTokens[strings.ToLower(lang)]
	return ok
}

// GetTokenID returns the ID for a specific token string, or -1 if not found
func (t *ArleTokenizer) GetTokenID(token string) int {
	t.mu.RLock()
	defer t.mu.RUnlock()
	if id, ok := t.vocab[token]; ok {
		return id
	}
	return -1
}

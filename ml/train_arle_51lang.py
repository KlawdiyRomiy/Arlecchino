# ============================================================
# ARLE Language Detection Model - Full 51 Languages Training
# ============================================================
# Run on Google Colab with T4 GPU
# Requires: HuggingFace token with access to bigcode/the-stack
# ============================================================

# %% [markdown]
# # Step 0: Enable GPU & Check Resources
# **IMPORTANT:** Runtime → Change runtime type → T4 GPU → Save

# %%
import torch
import psutil
import os

print("=" * 50)
print("RESOURCE CHECK")
print("=" * 50)
print(f"PyTorch: {torch.__version__}")
print(f"CUDA available: {torch.cuda.is_available()}")

if torch.cuda.is_available():
    print(f"GPU: {torch.cuda.get_device_name(0)}")
    print(
        f"GPU Memory: {torch.cuda.get_device_properties(0).total_memory / 1e9:.1f} GB"
    )
else:
    raise RuntimeError("No GPU! Enable T4 in Runtime → Change runtime type")

ram = psutil.virtual_memory()
print(f"RAM: {ram.total / 1e9:.1f} GB total, {ram.available / 1e9:.1f} GB available")
print(f"Disk: {psutil.disk_usage('/').free / 1e9:.1f} GB free")
print("=" * 50)
print("Ready for training!")

# %% [markdown]
# # Step 1: Install Dependencies

# %%
# !pip install -q datasets tokenizers torch onnx onnxruntime tqdm psutil huggingface_hub

# %% [markdown]
# # Step 2: HuggingFace Login
# Get token from: https://huggingface.co/settings/tokens

# %%
from huggingface_hub import login

# Paste your HuggingFace token here (or use getpass for security)
HF_TOKEN = "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"
login(token=HF_TOKEN)
print("Logged in to HuggingFace!")

# %% [markdown]
# # Step 3: Configuration - All 51 Languages

# %%
# ============================================================
# FULL 51 LANGUAGE CONFIGURATION
# ============================================================

# All 51 target languages with their the-stack identifiers
LANGUAGES = {
    # Tier 1: Critical (15 languages)
    "Python": "python",
    "JavaScript": "javascript",
    "TypeScript": "typescript",
    "Java": "java",
    "C#": "c-sharp",
    "C++": "c++",
    "C": "c",
    "Go": "go",
    "Rust": "rust",
    "PHP": "php",
    "Ruby": "ruby",
    "Swift": "swift",
    "Kotlin": "kotlin",
    "Scala": "scala",
    "Shell": "shell",
    # Tier 2: Important (12 languages)
    "Lua": "lua",
    "R": "r",
    "Perl": "perl",
    "Haskell": "haskell",
    "Clojure": "clojure",
    "Elixir": "elixir",
    "Erlang": "erlang",
    "Julia": "julia",
    "Dart": "dart",
    "Groovy": "groovy",
    "PowerShell": "powershell",
    "Objective-C": "objective-c",
    # Tier 3: Niche (16 languages)
    "F#": "f-sharp",
    "OCaml": "ocaml",
    "Fortran": "fortran",
    "COBOL": "cobol",
    "Ada": "ada",
    "Prolog": "prolog",
    "Common Lisp": "common-lisp",
    "Scheme": "scheme",
    "Racket": "racket",
    "Emacs Lisp": "emacs-lisp",
    "Assembly": "assembly",
    "VHDL": "vhdl",
    "Verilog": "verilog",
    "Zig": "zig",
    "Nim": "nim",
    "Crystal": "crystal",
    # Data formats (6 languages)
    "JSON": "json",
    "YAML": "yaml",
    "TOML": "toml",
    "XML": "xml",
    "Markdown": "markdown",
    "Dockerfile": "dockerfile",
    # Bonus: Additional useful languages (2)
    "SQL": "sql",
    "HTML": "html",
}

NUM_LANGUAGES = len(LANGUAGES)
print(f"Target languages: {NUM_LANGUAGES}")

# Training configuration
SAMPLES_PER_LANG = 5000  # 5K samples per language = 255K total
MAX_SEQ_LENGTH = 512  # Token sequence length
VOCAB_SIZE = 32000  # BPE vocabulary size
BATCH_SIZE = 48  # Batch size for T4
EPOCHS = 3  # Training epochs
LEARNING_RATE = 1e-3  # Learning rate

# Model configuration
EMBED_DIM = 256  # Embedding dimension
NUM_HEADS = 8  # Attention heads
NUM_LAYERS = 4  # Transformer layers
FF_DIM = 512  # Feed-forward dimension
DROPOUT = 0.1  # Dropout rate

print(f"Samples per language: {SAMPLES_PER_LANG:,}")
print(f"Estimated total samples: {NUM_LANGUAGES * SAMPLES_PER_LANG:,}")

# %% [markdown]
# # Step 4: Load Dataset (Streaming from the-stack)

# %%
from datasets import load_dataset
from tqdm import tqdm
import random
import gc

# File size limits
MIN_FILE_SIZE = 50
MAX_FILE_SIZE = 8000

all_code = []
lang_counts = {}
failed_langs = []

print(f"Loading from bigcode/the-stack (streaming)...")
print(f"Target: {SAMPLES_PER_LANG:,} samples per language\n")

for lang_name, lang_id in tqdm(LANGUAGES.items(), desc="Languages"):
    try:
        # Load dataset in streaming mode
        ds = load_dataset(
            "bigcode/the-stack",
            data_dir=f"data/{lang_id}",
            split="train",
            streaming=True,
            trust_remote_code=True,
        )

        count = 0
        for item in ds:
            if count >= SAMPLES_PER_LANG:
                break

            content = item.get("content", "")
            if not content or not isinstance(content, str):
                continue
            if len(content) < MIN_FILE_SIZE or len(content) > MAX_FILE_SIZE:
                continue

            all_code.append({"code": content, "language": lang_name})
            count += 1

        lang_counts[lang_name] = count
        if count > 0:
            print(f"  {lang_name}: {count:,}")
        else:
            print(f"  {lang_name}: EMPTY")
            failed_langs.append(lang_name)

    except Exception as e:
        print(f"  {lang_name}: FAILED ({str(e)[:50]})")
        failed_langs.append(lang_name)
        lang_counts[lang_name] = 0

    gc.collect()

print(f"\nTotal samples: {len(all_code):,}")
print(f"Languages loaded: {NUM_LANGUAGES - len(failed_langs)}/{NUM_LANGUAGES}")

if failed_langs:
    print(f"\nFailed languages: {failed_langs}")

# Shuffle data
random.shuffle(all_code)
gc.collect()

# Summary
print("\n" + "=" * 50)
print("DATASET SUMMARY")
print("=" * 50)
for lang, cnt in sorted(lang_counts.items(), key=lambda x: -x[1]):
    if cnt > 0:
        print(f"  {lang}: {cnt:,}")

# %% [markdown]
# # Step 5: Build Tokenizer

# %%
from tokenizers import Tokenizer, models, trainers, pre_tokenizers, processors

TOKENIZER_FILE = "arle_tokenizer_51lang.json"

print("Building BPE tokenizer...")

# Create BPE tokenizer
tokenizer = Tokenizer(models.BPE(unk_token="<UNK>"))
tokenizer.pre_tokenizer = pre_tokenizers.ByteLevel(add_prefix_space=False)

# Special tokens
special_tokens = ["<PAD>", "<UNK>", "<BOS>", "<EOS>", "<MASK>"]

# Train tokenizer
trainer = trainers.BpeTrainer(
    vocab_size=VOCAB_SIZE,
    special_tokens=special_tokens,
    show_progress=True,
    min_frequency=2,
)

# Train on code samples
code_texts = [item["code"] for item in all_code]
tokenizer.train_from_iterator(code_texts, trainer)

# Add post-processor
tokenizer.post_processor = processors.ByteLevel(trim_offsets=False)

# Save tokenizer
tokenizer.save(TOKENIZER_FILE)
print(f"Tokenizer saved: {TOKENIZER_FILE}")
print(f"Vocab size: {tokenizer.get_vocab_size():,}")

# Test tokenization
test_samples = [
    "def hello():\n    print('Hello')",
    "function hello() { console.log('Hello'); }",
    'func main() { fmt.Println("Hello") }',
    "public class Hello { public static void main(String[] args) {} }",
]
print("\nTokenization test:")
for sample in test_samples:
    tokens = tokenizer.encode(sample).tokens[:8]
    print(f"  '{sample[:35]}...' → {tokens}")

# %% [markdown]
# # Step 6: Prepare PyTorch Dataset

# %%
import torch
from torch.utils.data import Dataset, DataLoader


class LanguageDataset(Dataset):
    def __init__(self, data, tokenizer, lang2idx, max_length=512):
        self.data = data
        self.tokenizer = tokenizer
        self.lang2idx = lang2idx
        self.max_length = max_length

    def __len__(self):
        return len(self.data)

    def __getitem__(self, idx):
        item = self.data[idx]

        # Tokenize
        encoding = self.tokenizer.encode(item["code"])
        ids = encoding.ids[: self.max_length]

        # Pad
        if len(ids) < self.max_length:
            ids = ids + [0] * (self.max_length - len(ids))

        # Get label
        label = self.lang2idx[item["language"]]

        return torch.tensor(ids, dtype=torch.long), torch.tensor(
            label, dtype=torch.long
        )


# Create language mapping
lang2idx = {lang: idx for idx, lang in enumerate(sorted(LANGUAGES.keys()))}
idx2lang = {idx: lang for lang, idx in lang2idx.items()}

print(f"Language mapping: {len(lang2idx)} languages")

# Create dataset
print("Tokenizing samples...")
dataset = LanguageDataset(all_code, tokenizer, lang2idx, MAX_SEQ_LENGTH)

# Split train/val
train_size = int(0.95 * len(dataset))
val_size = len(dataset) - train_size
train_dataset, val_dataset = torch.utils.data.random_split(
    dataset, [train_size, val_size]
)

print(f"Train: {len(train_dataset):,}, Val: {len(val_dataset):,}")

# Create data loaders
train_loader = DataLoader(train_dataset, batch_size=BATCH_SIZE, shuffle=True)
val_loader = DataLoader(val_dataset, batch_size=BATCH_SIZE, shuffle=False)

# %% [markdown]
# # Step 7: Define Model

# %%
import torch.nn as nn
import math


class LanguageDetector(nn.Module):
    def __init__(
        self,
        vocab_size,
        num_classes,
        embed_dim=256,
        num_heads=8,
        num_layers=4,
        ff_dim=512,
        max_seq_len=512,
        dropout=0.1,
    ):
        super().__init__()

        self.embed_dim = embed_dim

        # Token embedding
        self.token_embedding = nn.Embedding(vocab_size, embed_dim, padding_idx=0)

        # Positional encoding
        self.pos_embedding = nn.Embedding(max_seq_len, embed_dim)

        # Transformer encoder
        encoder_layer = nn.TransformerEncoderLayer(
            d_model=embed_dim,
            nhead=num_heads,
            dim_feedforward=ff_dim,
            dropout=dropout,
            batch_first=True,
        )
        self.transformer = nn.TransformerEncoder(encoder_layer, num_layers=num_layers)

        # Classification head
        self.classifier = nn.Sequential(
            nn.Linear(embed_dim, embed_dim),
            nn.ReLU(),
            nn.Dropout(dropout),
            nn.Linear(embed_dim, num_classes),
        )

        self.dropout = nn.Dropout(dropout)

        # Initialize weights
        self._init_weights()

    def _init_weights(self):
        for p in self.parameters():
            if p.dim() > 1:
                nn.init.xavier_uniform_(p)

    def forward(self, x):
        batch_size, seq_len = x.shape

        # Create position indices
        positions = (
            torch.arange(seq_len, device=x.device).unsqueeze(0).expand(batch_size, -1)
        )

        # Embeddings
        tok_emb = self.token_embedding(x)
        pos_emb = self.pos_embedding(positions)
        x = self.dropout(tok_emb + pos_emb)

        # Create padding mask
        padding_mask = x.sum(dim=-1) == 0

        # Transformer
        x = self.transformer(x, src_key_padding_mask=padding_mask)

        # Global average pooling (ignore padding)
        mask = (~padding_mask).unsqueeze(-1).float()
        x = (x * mask).sum(dim=1) / mask.sum(dim=1).clamp(min=1)

        # Classify
        return self.classifier(x)


# Create model
device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
print(f"Using device: {device}")

model = LanguageDetector(
    vocab_size=VOCAB_SIZE,
    num_classes=NUM_LANGUAGES,
    embed_dim=EMBED_DIM,
    num_heads=NUM_HEADS,
    num_layers=NUM_LAYERS,
    ff_dim=FF_DIM,
    max_seq_len=MAX_SEQ_LENGTH,
    dropout=DROPOUT,
).to(device)

# Count parameters
total_params = sum(p.numel() for p in model.parameters())
trainable_params = sum(p.numel() for p in model.parameters() if p.requires_grad)
print(f"\nModel parameters: {total_params:,}")
print(f"Trainable: {trainable_params:,}")
print(f"Estimated size: ~{total_params * 4 / 1e6:.1f} MB (FP32)")

# %% [markdown]
# # Step 8: Training Loop

# %%
import time
from torch.optim import AdamW
from torch.optim.lr_scheduler import CosineAnnealingLR

# Loss and optimizer
criterion = nn.CrossEntropyLoss()
optimizer = AdamW(model.parameters(), lr=LEARNING_RATE, weight_decay=0.01)
scheduler = CosineAnnealingLR(optimizer, T_max=EPOCHS * len(train_loader))


# Training function
def train_epoch(model, loader, criterion, optimizer, scheduler, device):
    model.train()
    total_loss = 0
    correct = 0
    total = 0

    pbar = tqdm(loader, desc="Training", leave=False)
    for batch_idx, (inputs, labels) in enumerate(pbar):
        inputs, labels = inputs.to(device), labels.to(device)

        optimizer.zero_grad()
        outputs = model(inputs)
        loss = criterion(outputs, labels)
        loss.backward()

        # Gradient clipping
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)

        optimizer.step()
        scheduler.step()

        total_loss += loss.item()
        _, predicted = outputs.max(1)
        total += labels.size(0)
        correct += predicted.eq(labels).sum().item()

        pbar.set_postfix({"loss": f"{loss.item():.4f}"})

    return total_loss / len(loader), 100.0 * correct / total


# Validation function
def validate(model, loader, criterion, device):
    model.eval()
    total_loss = 0
    correct = 0
    total = 0

    with torch.no_grad():
        for inputs, labels in tqdm(loader, desc="Validating", leave=False):
            inputs, labels = inputs.to(device), labels.to(device)
            outputs = model(inputs)
            loss = criterion(outputs, labels)

            total_loss += loss.item()
            _, predicted = outputs.max(1)
            total += labels.size(0)
            correct += predicted.eq(labels).sum().item()

    return total_loss / len(loader), 100.0 * correct / total


# Training
print("=" * 60)
print(f"TRAINING: {NUM_LANGUAGES} Languages")
print(f"Epochs: {EPOCHS}, LR: {LEARNING_RATE}")
print("=" * 60)

best_val_loss = float("inf")
training_start = time.time()

for epoch in range(1, EPOCHS + 1):
    print(f"\n--- Epoch {epoch}/{EPOCHS} ---")

    train_loss, train_acc = train_epoch(
        model, train_loader, criterion, optimizer, scheduler, device
    )
    val_loss, val_acc = validate(model, val_loader, criterion, device)

    print(f"Train Loss: {train_loss:.4f} | Train Acc: {train_acc:.2f}%")
    print(f"Val Loss: {val_loss:.4f} | Val Acc: {val_acc:.2f}%")

    # Save best model
    if val_loss < best_val_loss:
        best_val_loss = val_loss
        torch.save(model.state_dict(), "arle_model_best.pth")
        print(f"Saved checkpoint (val_loss: {val_loss:.4f})")

elapsed = time.time() - training_start
print(f"\nTraining completed in {elapsed / 60:.1f} minutes")
print(f"Best validation loss: {best_val_loss:.4f}")

# %% [markdown]
# # Step 9: Export Model

# %%
# Load best model
model.load_state_dict(torch.load("arle_model_best.pth"))
model.eval()

# Export to TorchScript
print("Exporting to TorchScript...")
dummy = torch.randint(0, 1000, (1, MAX_SEQ_LENGTH)).to(device)

with torch.no_grad():
    traced = torch.jit.trace(model, dummy)
    traced.save("arle_model.pt")

print(
    f"Exported: arle_model.pt ({os.path.getsize('arle_model.pt') / 1024 / 1024:.2f} MB)"
)

# Export to ONNX
print("\nExporting to ONNX...")
torch.onnx.export(
    model,
    dummy,
    "arle_model.onnx",
    input_names=["input"],
    output_names=["output"],
    dynamic_axes={"input": {0: "batch_size"}, "output": {0: "batch_size"}},
    opset_version=14,
)
print(
    f"Exported: arle_model.onnx ({os.path.getsize('arle_model.onnx') / 1024 / 1024:.2f} MB)"
)

# %% [markdown]
# # Step 10: Save Language Mapping

# %%
import json

# Save language mapping
mapping = {
    "lang2idx": lang2idx,
    "idx2lang": idx2lang,
    "num_languages": NUM_LANGUAGES,
    "languages": list(LANGUAGES.keys()),
    "config": {
        "vocab_size": VOCAB_SIZE,
        "embed_dim": EMBED_DIM,
        "num_heads": NUM_HEADS,
        "num_layers": NUM_LAYERS,
        "ff_dim": FF_DIM,
        "max_seq_len": MAX_SEQ_LENGTH,
    },
}

with open("arle_lang_mapping.json", "w") as f:
    json.dump(mapping, f, indent=2)

print("Saved: arle_lang_mapping.json")
print(f"\nLanguages ({NUM_LANGUAGES}):")
for i, lang in enumerate(sorted(LANGUAGES.keys())):
    print(f"  {i:2d}: {lang}")

# %% [markdown]
# # Step 11: Test Model


# %%
def predict_language(code: str, top_k: int = 3):
    """Predict language for code snippet."""
    model.eval()

    # Tokenize
    encoding = tokenizer.encode(code)
    ids = encoding.ids[:MAX_SEQ_LENGTH]
    if len(ids) < MAX_SEQ_LENGTH:
        ids = ids + [0] * (MAX_SEQ_LENGTH - len(ids))

    # Predict
    with torch.no_grad():
        inputs = torch.tensor([ids], dtype=torch.long).to(device)
        outputs = model(inputs)
        probs = torch.softmax(outputs, dim=-1)

        top_probs, top_indices = probs.topk(top_k)

        results = []
        for prob, idx in zip(top_probs[0], top_indices[0]):
            lang = idx2lang[idx.item()]
            results.append((lang, prob.item()))

        return results


# Test samples
test_cases = [
    ("def hello():\n    print('Hello, World!')", "Python"),
    ("function hello() { console.log('Hello'); }", "JavaScript"),
    ('fn main() { println!("Hello"); }', "Rust"),
    ('func main() { fmt.Println("Hello") }', "Go"),
    ("public class Hello { public static void main(String[] args) {} }", "Java"),
    ("<?php echo 'Hello'; ?>", "PHP"),
    ("puts 'Hello'", "Ruby"),
    ('fun main() { println("Hello") }', "Kotlin"),
    ('print("Hello")', "Swift"),
    ("console.log('Hello');", "TypeScript"),
    ('{"key": "value"}', "JSON"),
    ("SELECT * FROM users;", "SQL"),
    ("FROM ubuntu:20.04\nRUN apt-get update", "Dockerfile"),
]

print("\n" + "=" * 60)
print("MODEL TEST")
print("=" * 60)

correct = 0
for code, expected in test_cases:
    predictions = predict_language(code)
    predicted = predictions[0][0]
    confidence = predictions[0][1]

    status = "OK" if predicted == expected else "FAIL"
    if predicted == expected:
        correct += 1

    print(
        f"[{status}] Expected: {expected:12s} | Predicted: {predicted:12s} ({confidence:.1%})"
    )

print(
    f"\nAccuracy: {correct}/{len(test_cases)} ({100 * correct / len(test_cases):.0f}%)"
)

# %% [markdown]
# # Step 12: Download Files
#
# Download these files from Colab:
# - `arle_model.pt` - TorchScript model
# - `arle_model.onnx` - ONNX model
# - `arle_tokenizer_51lang.json` - Tokenizer
# - `arle_lang_mapping.json` - Language mapping

# %%
print("\n" + "=" * 60)
print("FILES TO DOWNLOAD")
print("=" * 60)

files = [
    "arle_model.pt",
    "arle_model.onnx",
    "arle_tokenizer_51lang.json",
    "arle_lang_mapping.json",
]
for f in files:
    if os.path.exists(f):
        size = os.path.getsize(f) / 1024 / 1024
        print(f"  {f}: {size:.2f} MB")
    else:
        print(f"  {f}: NOT FOUND")

print("\nUse Files panel (left sidebar) → Right-click → Download")
print("Or run: from google.colab import files; files.download('arle_model.pt')")

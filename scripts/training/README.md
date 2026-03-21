# ARLE Model Retraining - Complete Package

## 📦 What Was Created

This package provides everything needed to retrain the ARLE (Arlecchino Language Engine) model for **code completion ranking** (NOT language detection).

## 🗂️ Files Created

### 1. **Configuration File**
**Location**: `scripts/training/arle_model_config.yaml`

Complete YAML configuration with:
- Model architecture parameters (BiLSTM + Attention)
- Training hyperparameters (batch size, learning rate, epochs)
- 51 languages organized in 4 tiers
- Data sources and filters
- Export settings (ONNX, INT8 quantization)
- Evaluation metrics

**Purpose**: Single source of truth for all training parameters. Edit this file to customize training.

### 2. **Training Notebook**
**Location**: `scripts/training/arle_ranking_model.ipynb`

Google Colab-compatible Jupyter notebook with:
- **Step 0**: GPU resource check
- **Step 1**: Install dependencies
- **Step 2**: Load configuration
- **Step 3**: HuggingFace authentication
- **Step 4**: Load & prepare data from The Stack v2
- **Step 5**: Build BPE tokenizer (8K vocab)
- **Step 6**: Create PyTorch datasets (pairwise ranking)
- **Step 7**: Define BiLSTM + Attention model
- **Step 8**: Training loop (5 epochs, ~3-4 hours)
- **Step 9**: Export to ONNX INT8 (~20MB)
- **Step 10**: Test exported model
- **Step 11**: Download instructions

**Purpose**: Complete, runnable training pipeline. Upload to Google Colab and run cells sequentially.

### 3. **Training Guide**
**Location**: `docs/ARLE_TRAINING_GUIDE.md`

Comprehensive documentation (45+ pages) covering:
- **Architecture**: Detailed BiLSTM + Attention explanation
- **How It Works**: Ranking task, input/output format, integration
- **Training Data**: 51 languages, pairwise samples, negative sampling strategies
- **How to Retrain**: Step-by-step Colab instructions
- **Evaluation**: Metrics (NDCG, MRR, MAP), validation, testing
- **Deployment**: Copy files, verify loading, troubleshooting
- **Troubleshooting**: Common issues and solutions
- **Advanced Topics**: Alternative architectures, multi-task learning, ensembles

**Purpose**: Reference manual for understanding, training, and deploying ARLE model.

## 🎯 Key Differences from Previous Model

| Aspect | Old Model (Language Detection) | New Model (Ranking) |
|--------|-------------------------------|---------------------|
| **Task** | 51-class classification | Pairwise ranking |
| **Loss** | CrossEntropyLoss | MarginRankingLoss |
| **Output** | Class probabilities (51 dims) | Score (1 dim) |
| **Input** | Code snippet | Context + Completion |
| **Purpose** | Detect language | Rank completion quality |
| **Size** | 91MB FP32 | 20MB INT8 |
| **Architecture** | Transformer encoder | BiLSTM + Attention |

## 🚀 Quick Start

### For Users Who Want to Retrain

1. **Open Colab**: Upload `scripts/training/arle_ranking_model.ipynb`
2. **Enable GPU**: Runtime → Change runtime type → T4 GPU
3. **Get HF Token**: https://huggingface.co/settings/tokens
4. **Run All Cells**: Takes 3-4 hours
5. **Download Files**:
   - `arle_model_ranking.onnx` (~20MB)
   - `arle_tokenizer_ranking.json` (~2MB)
6. **Copy to Assets**:
   ```bash
   cp arle_model_ranking.onnx arlecchino/assets/arle_model.onnx
   cp arle_tokenizer_ranking.json arlecchino/assets/arle_tokenizer_51lang.json
   ```
7. **Rebuild Arlecchino**: `wails build`

### For Developers Who Want to Customize

1. **Edit Config**: Modify `scripts/training/arle_model_config.yaml`
   - Adjust `epochs`, `batch_size`, `learning_rate`
   - Change `samples_per_lang` for more/less data
   - Modify `model` architecture (embed_dim, lstm_hidden, etc.)
   - Focus on specific languages

2. **Advanced Customization**: Edit notebook cells
   - Change data sources (use local files instead of The Stack)
   - Implement different negative sampling strategies
   - Add hard negative mining
   - Try different model architectures (Transformer, CNN, etc.)
   - Implement multi-task learning

3. **Read Guide**: `docs/ARLE_TRAINING_GUIDE.md`
   - Understand architecture decisions
   - Learn about evaluation metrics
   - Troubleshoot common issues
   - Explore advanced topics

## 📊 Expected Results

### Training Metrics (After 5 Epochs)

| Metric | Target | Notes |
|--------|--------|-------|
| Train Accuracy | 85-90% | Positive scored higher than negative |
| Val Accuracy | 82-88% | Slight drop from train (normal) |
| NDCG@5 | >0.70 | Quality of top-5 rankings |
| MRR | >0.60 | Mean reciprocal rank |
| Model Size (INT8) | ~20MB | After quantization |
| Inference Time | <50ms | Score 50 completions |

### Example Output

```
Epoch 5/5
---------------------------------------------------------
Train Loss: 0.1823 | Train Acc: 87.3%
Val Loss: 0.2041 | Val Acc: 84.6%
✓ Saved checkpoint (val_acc: 84.6%)

✓ Training completed in 3.2 hours
✓ Best validation accuracy: 84.6%

Exporting to ONNX...
✓ ONNX FP32 exported: 41.2 MB
✓ ONNX INT8 exported: 19.8 MB
✓ Compression: 2.1x smaller

MODEL TEST
============================================================
Test 1: Python fibonacci
  Good: return fibonacci(n-1) + fibonacci(n-2) → score=2.341
  Bad:  print("hello world") → score=-0.823
  ✓ PASS: Good completion scored higher

Test 2: JavaScript add function
  Good: return a + b; → score=1.982
  Bad:  def hello(): pass → score=-1.234
  ✓ PASS: Good completion scored higher
```

## 🏗️ Model Architecture

```
Input: [batch, seq_len] Token IDs
    ↓
┌─────────────────────────────────────┐
│  Embedding (vocab=8000 → dim=128)   │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│  BiLSTM Layer 1 (128 → 256)         │
│  BiLSTM Layer 2 (256 → 256)         │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│  Attention Mechanism (dim=64)       │
│  Weighted Pooling → [batch, 256]    │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│  MLP Score Head (256 → 128 → 1)     │
│  ReLU + Dropout                     │
└─────────────────────────────────────┘
    ↓
Output: [batch] Scores (float)
```

## 🔧 Integration with Arlecchino

### Current Integration Points

1. **`arle_backend.go`**: ONNX model loading and inference
   ```go
   func (b *ONNXBackend) ScoreSuggestion(contextTokens []int, suggestion string) float64
   ```

2. **`smart_ranker.go`**: Uses ARLE scores in ranking
   ```go
   mlScore := arleBackend.ScoreSuggestion(ctx.Prefix, sugg.Text)
   suggestions[i].Score += 0.05 * mlScore  // 5% weight
   ```

3. **`arle.go`**: Lazy loading, state management
4. **`arle_tokenizer.go`**: BPE tokenization

### How Rankings Work

Current ranking formula:
```
finalScore = 
    0.25 * prefixMatch +
    0.20 * frequency +
    0.15 * recency +
    0.15 * context +
    0.10 * locality +
    0.10 * cooccurrence +
    0.05 * mlScore  ← ARLE model
```

**To increase ML influence**: Edit `smart_ranker.go`:
```go
weights := RankingWeights{
    ML: 0.15,  // Increase from 0.05
    Match: 0.20,  // Reduce others proportionally
    // ...
}
```

## 📈 Performance Optimization

### Training Speed

- **Free Colab (T4)**: ~3-4 hours for 51 languages
- **Colab Pro (V100)**: ~1.5-2 hours
- **Local RTX 3090**: ~1-1.5 hours
- **Local GTX 1080**: ~4-5 hours

### Inference Speed (Production)

- **Score 50 completions**: <50ms (target)
- **Cold start**: <200ms
- **Memory usage**: ~100MB (model + buffers)

### Optimizations Applied

1. **INT8 Quantization**: 2x smaller, 1.5-2x faster
2. **Reduced Vocab**: 8K instead of 32K
3. **Smaller Hidden Dim**: 128 instead of 256
4. **Efficient Attention**: Single attention layer
5. **ONNX Runtime**: Optimized inference engine

## 🐛 Troubleshooting Quick Reference

| Issue | Solution |
|-------|----------|
| GPU OOM | Reduce `batch_size` to 32 or 16 |
| Training too slow | Use fewer languages (tier_1 only) |
| Low accuracy (<70%) | Increase `samples_per_lang` or `epochs` |
| Model not loading | Check ONNX Runtime installation |
| Bad rankings | Increase ML weight in `smart_ranker.go` |
| ONNX export failed | Use `opset_version=12` instead of 14 |

Full troubleshooting guide in `docs/ARLE_TRAINING_GUIDE.md`.

## 📚 Additional Resources

### Files in This Package

```
scripts/training/
├── arle_model_config.yaml          # Configuration
└── arle_ranking_model.ipynb        # Training notebook

docs/
└── ARLE_TRAINING_GUIDE.md          # Comprehensive guide

arlecchino/assets/  (after training)
├── arle_model.onnx                 # INT8 quantized model (~20MB)
└── arle_tokenizer_51lang.json      # BPE tokenizer (~2MB)
```

### External Links

- **The Stack v2 Dataset**: https://huggingface.co/datasets/bigcode/the-stack-v2
- **ONNX Runtime**: https://onnxruntime.ai/docs/get-started/with-go.html
- **PyTorch Docs**: https://pytorch.org/docs/stable/index.html
- **Google Colab**: https://colab.research.google.com

## ✅ Checklist

Before deploying the new model, verify:

- [ ] Model trains to >80% validation accuracy
- [ ] Model exports to ONNX successfully
- [ ] ONNX model size is ~20MB (INT8)
- [ ] Test cases show good > bad scores
- [ ] Model loads in Arlecchino without errors
- [ ] Inference time is <50ms for 50 completions
- [ ] Completions are visibly better ranked
- [ ] No memory leaks after extended use

## 🎓 Learning Path

1. **Read Guide**: Start with `docs/ARLE_TRAINING_GUIDE.md`
2. **Review Config**: Understand `arle_model_config.yaml`
3. **Run Notebook**: Execute `arle_ranking_model.ipynb` step-by-step
4. **Experiment**: Try different hyperparameters
5. **Customize**: Add new languages, change architecture
6. **Deploy**: Integrate into Arlecchino
7. **Monitor**: Check metrics, gather user feedback
8. **Iterate**: Retrain with improvements

## 🔄 Continuous Improvement

Future enhancements to consider:

1. **More Training Data**: 10K samples per language instead of 5K
2. **Larger Model**: 256 hidden dim, 3 LSTM layers
3. **Longer Context**: 256 tokens instead of 128
4. **Domain-Specific Models**: Separate models for web dev, ML, systems
5. **Multi-Task Learning**: Ranking + language detection + syntax checking
6. **User Personalization**: Fine-tune on individual user patterns
7. **Continuous Learning**: Update model from production feedback

## 📝 Notes

### Why Pairwise Ranking?

The model learns: **score(good) > score(bad) + margin**

This is better than classification because:
- We don't need to generate completions (slower)
- We already have candidates from other sources
- Direct optimization for ranking quality
- Smaller, faster model

### Why BiLSTM + Attention?

- **BiLSTM**: Captures forward + backward context
- **Attention**: Focuses on important tokens (function names, keywords)
- **Size**: Much smaller than Transformer (20MB vs 100MB+)
- **Speed**: Faster inference (no self-attention quadratic cost)

### Why INT8 Quantization?

- **2x smaller**: 20MB instead of 40MB
- **1.5-2x faster**: Integer ops faster than float
- **Minimal accuracy loss**: <1% drop with dynamic quantization
- **Better for production**: Lower memory, faster startup

---

## 🎉 Summary

You now have everything needed to:

1. ✅ Understand how ARLE ranking model works
2. ✅ Train a new model from scratch
3. ✅ Customize architecture and hyperparameters
4. ✅ Export to ONNX INT8 for production
5. ✅ Deploy and integrate with Arlecchino
6. ✅ Troubleshoot common issues
7. ✅ Continuously improve the model

**Next Steps**:

1. Upload `arle_ranking_model.ipynb` to Google Colab
2. Get HuggingFace token
3. Run training (3-4 hours)
4. Download model files
5. Copy to `arlecchino/assets/`
6. Test in production!

Good luck! 🚀

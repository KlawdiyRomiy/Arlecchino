#!/usr/bin/env python3
"""
Convert TorchScript model (.pt) to ONNX format.
Handles MultiheadAttention by decomposing into basic ops.
"""

import os
import sys
import math
import warnings

# Suppress warnings
warnings.filterwarnings("ignore")

# Force legacy exporter
os.environ["TORCH_ONNX_USE_OLD_EXPORTER"] = "1"


def main():
    try:
        import torch
        import torch.nn as nn
        import torch.nn.functional as F
    except ImportError:
        print("PyTorch not installed. Run: pip install torch")
        sys.exit(1)

    script_dir = os.path.dirname(os.path.abspath(__file__))
    assets_dir = os.path.join(script_dir, "..", "..", "assets")

    pt_path = os.path.join(assets_dir, "arle_model.pt")
    onnx_path = os.path.join(assets_dir, "arle_model.onnx")

    if not os.path.exists(pt_path):
        print(f"Model not found: {pt_path}")
        sys.exit(1)

    print(f"Loading TorchScript model from {pt_path}...")
    original_model = torch.jit.load(pt_path, map_location="cpu")
    original_model.eval()

    # Extract state dict
    state_dict = {}
    for name, param in original_model.named_parameters():
        state_dict[name] = param.data.clone()
        print(f"  {name}: {param.shape}")

    # Model config from weights
    vocab_size = state_dict["embedding.weight"].shape[0]
    embed_dim = state_dict["embedding.weight"].shape[1]
    max_seq_len = state_dict["pos_embedding.weight"].shape[0]
    hidden_size = state_dict["lstm.weight_hh_l0"].shape[1]
    lstm_output_dim = hidden_size * 2
    num_heads = 8
    
    print(f"\nModel config: vocab={vocab_size}, embed={embed_dim}, hidden={hidden_size}")

    class DecomposedAttention(nn.Module):
        def __init__(self, embed_dim, num_heads):
            super().__init__()
            self.embed_dim = embed_dim
            self.num_heads = num_heads
            self.head_dim = embed_dim // num_heads
            self.scale = 1.0 / math.sqrt(self.head_dim)
            self.in_proj_weight = nn.Parameter(torch.empty(3 * embed_dim, embed_dim))
            self.in_proj_bias = nn.Parameter(torch.empty(3 * embed_dim))
            self.out_proj = nn.Linear(embed_dim, embed_dim)
        
        def forward(self, x):
            batch_size, seq_len, _ = x.shape
            qkv = F.linear(x, self.in_proj_weight, self.in_proj_bias)
            q, k, v = qkv.chunk(3, dim=-1)
            q = q.view(batch_size, seq_len, self.num_heads, self.head_dim).transpose(1, 2)
            k = k.view(batch_size, seq_len, self.num_heads, self.head_dim).transpose(1, 2)
            v = v.view(batch_size, seq_len, self.num_heads, self.head_dim).transpose(1, 2)
            attn_weights = torch.matmul(q, k.transpose(-2, -1)) * self.scale
            attn_weights = F.softmax(attn_weights, dim=-1)
            attn_output = torch.matmul(attn_weights, v)
            attn_output = attn_output.transpose(1, 2).contiguous().view(batch_size, seq_len, self.embed_dim)
            return self.out_proj(attn_output)

    class ArleLSTMWrapper(nn.Module):
        def __init__(self, vocab_size, embed_dim, hidden_size, max_seq_len, num_heads):
            super().__init__()
            self.max_seq_len = max_seq_len
            self.embedding = nn.Embedding(vocab_size, embed_dim)
            self.pos_embedding = nn.Embedding(max_seq_len, embed_dim)
            self.lstm = nn.LSTM(embed_dim, hidden_size, num_layers=2, batch_first=True, bidirectional=True)
            self.attention = DecomposedAttention(hidden_size * 2, num_heads)
            self.layer_norm = nn.LayerNorm(hidden_size * 2)
            self.next_token_head = nn.Linear(hidden_size * 2, vocab_size)
        
        def forward(self, x):
            batch_size, seq_len = x.shape
            positions = torch.arange(seq_len, device=x.device, dtype=torch.long)
            positions = positions.unsqueeze(0).expand(batch_size, -1)
            x = self.embedding(x) + self.pos_embedding(positions)
            lstm_out, _ = self.lstm(x)
            attn_out = self.attention(lstm_out)
            x = lstm_out + attn_out
            x = self.layer_norm(x)
            return self.next_token_head(x)

    print("\nCreating wrapper model...")
    wrapper = ArleLSTMWrapper(vocab_size, embed_dim, hidden_size, max_seq_len, num_heads)
    
    # Load weights
    wrapper.embedding.weight.data = state_dict["embedding.weight"]
    wrapper.pos_embedding.weight.data = state_dict["pos_embedding.weight"]
    for name in ["weight_ih_l0", "weight_hh_l0", "bias_ih_l0", "bias_hh_l0",
                 "weight_ih_l0_reverse", "weight_hh_l0_reverse", "bias_ih_l0_reverse", "bias_hh_l0_reverse",
                 "weight_ih_l1", "weight_hh_l1", "bias_ih_l1", "bias_hh_l1",
                 "weight_ih_l1_reverse", "weight_hh_l1_reverse", "bias_ih_l1_reverse", "bias_hh_l1_reverse"]:
        getattr(wrapper.lstm, name).data = state_dict[f"lstm.{name}"]
    wrapper.attention.in_proj_weight.data = state_dict["attention.in_proj_weight"]
    wrapper.attention.in_proj_bias.data = state_dict["attention.in_proj_bias"]
    wrapper.attention.out_proj.weight.data = state_dict["attention.out_proj.weight"]
    wrapper.attention.out_proj.bias.data = state_dict["attention.out_proj.bias"]
    wrapper.layer_norm.weight.data = state_dict["layer_norm.weight"]
    wrapper.layer_norm.bias.data = state_dict["layer_norm.bias"]
    wrapper.next_token_head.weight.data = state_dict["next_token_head.weight"]
    wrapper.next_token_head.bias.data = state_dict["next_token_head.bias"]
    wrapper.eval()

    # Verify
    print("Verifying wrapper...")
    seq_len = 128
    test_input = torch.randint(0, vocab_size, (1, seq_len))
    with torch.no_grad():
        orig_out = original_model(test_input)
        wrap_out = wrapper(test_input)
        diff = (orig_out - wrap_out).abs().max().item()
        print(f"  Max diff: {diff:.6f} {'OK' if diff < 0.01 else 'WARN'}")

    # Trace and export
    print(f"\nTracing model...")
    dummy_input = torch.zeros(1, seq_len, dtype=torch.long)
    
    with torch.no_grad():
        traced = torch.jit.trace(wrapper, dummy_input)
    
    print("Exporting traced model to ONNX...")
    
    # Use the internal JIT-based export path
    from torch.onnx._internal.torchscript_exporter import utils as jit_utils
    
    # Direct protobuf export
    with torch.no_grad():
        # Run through JIT graph to get ONNX graph
        graph = traced.graph
        
        # Use torch._C to export
        torch._C._jit_pass_onnx_function_substitution(graph)
        
    # Alternative: save TorchScript and convert via onnx-script
    ts_path = onnx_path.replace(".onnx", "_traced.pt")
    traced.save(ts_path)
    print(f"  Saved traced model to {ts_path}")
    
    # Try direct ONNX export with explicit dynamo=False
    try:
        # Monkey-patch to force legacy path
        import torch.onnx
        original_export = torch.onnx.export
        
        def patched_export(*args, **kwargs):
            kwargs["dynamo"] = False
            kwargs.pop("dynamic_axes", None)  # Not supported in legacy for some models
            return original_export(*args, **kwargs)
        
        with torch.no_grad():
            torch.onnx.export(
                traced,
                dummy_input,
                onnx_path,
                export_params=True,
                opset_version=14,
                input_names=["input_ids"],
                output_names=["logits"],
                dynamo=False,
            )
        print(f"ONNX saved to {onnx_path}")
        print(f"Size: {os.path.getsize(onnx_path) / 1024 / 1024:.2f} MB")
        
    except Exception as e:
        print(f"Export failed: {e}")
        
        # Fallback: export via ONNX Script
        print("\nTrying onnxscript conversion...")
        try:
            import onnxscript
            from onnxscript import opset17 as op
            
            # Simple wrapper
            @onnxscript.script()
            def model_script(input_ids):
                return traced(input_ids)
            
            model_script.save(onnx_path)
            print(f"ONNX saved via onnxscript to {onnx_path}")
        except Exception as e2:
            print(f"onnxscript also failed: {e2}")
            print("\nManual ONNX export failed. Model will use PureGoBackend.")
            sys.exit(1)

    # Verify
    print("\nVerifying ONNX model...")
    try:
        import onnx
        onnx_model = onnx.load(onnx_path)
        onnx.checker.check_model(onnx_model)
        print("ONNX model valid!")
        
        import onnxruntime as ort
        session = ort.InferenceSession(onnx_path, providers=["CPUExecutionProvider"])
        onnx_out = session.run(None, {"input_ids": test_input.numpy()})[0]
        onnx_diff = abs(wrap_out.numpy() - onnx_out).max()
        print(f"ONNX Runtime diff: {onnx_diff:.6f}")
        
    except Exception as e:
        print(f"Verification: {e}")

    print("\nDone!")


if __name__ == "__main__":
    main()

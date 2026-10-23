"""Official OpenAI Python SDK against Spindle. Needs SPINDLE_API_KEY. Run: python openai-python.py"""
import os
import sys

from openai import OpenAI

base_url = os.environ.get("SPINDLE_API_URL", "http://127.0.0.1:7200") + "/v1"
api_key = os.environ.get("SPINDLE_API_KEY")
if not api_key:
    sys.exit("FAIL openai-python.py: set SPINDLE_API_KEY")
client = OpenAI(base_url=base_url, api_key=api_key)

try:
    models = client.models.list().data
    model = os.environ.get("SPINDLE_MODEL") or next(
        (m.id for m in models if getattr(m, "kind", None) == "chat" and getattr(m, "available", False)), None
    )
    if not model:
        raise RuntimeError("no available chat model (is a node connected?)")

    # Non-stream. with_raw_response exposes the Spindle headers.
    raw = client.chat.completions.with_raw_response.create(
        model=model, max_tokens=64, messages=[{"role": "user", "content": "Say hello in five words."}]
    )
    completion = raw.parse()
    job_id = raw.headers.get("x-spindle-job-id")
    print(completion.choices[0].message.content)
    print("job", job_id, "receipt", raw.headers.get("x-spindle-receipt"))
    print("charge (micros USDG)", raw.headers.get("x-spindle-charge-micros"))
    if not job_id:
        raise RuntimeError("missing X-Spindle-Job-Id")

    # Stream. The final chunk carries usage and spindle={jobId, chargeMicros, receiptUrl}.
    meta = None
    stream = client.chat.completions.create(
        model=model, stream=True, max_tokens=64, messages=[{"role": "user", "content": "Count to five."}]
    )
    for chunk in stream:
        if chunk.choices and chunk.choices[0].delta.content:
            print(chunk.choices[0].delta.content, end="", flush=True)
        extra = getattr(chunk, "model_extra", None) or {}
        if extra.get("spindle"):
            meta = extra["spindle"]
    print()
    if not meta:
        raise RuntimeError("no spindle meta in the final chunk")
    print(f"PASS openai-python.py (job {job_id})")
except Exception as err:  # noqa: BLE001
    sys.exit(f"FAIL openai-python.py: {err}")

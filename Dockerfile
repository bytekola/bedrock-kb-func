FROM owebui-base-image:latest

ARG BUILD_HASH=dev-build-offline

ENV ENV=prod \
    PORT=8080 \
    OLLAMA_BASE_URL="/ollama" \
    OPENAI_API_BASE_URL="" \
    OPENAI_API_KEY="" \
    WEBUI_SECRET_KEY="asd" \
    SCARF_NO_ANALYTICS=true \
    DO_NOT_TRACK=true \
    ANONYMIZED_TELEMETRY=false \
    WHISPER_MODEL="base" \
    PYTHONPATH=/app/backend \
    WHISPER_MODEL_DIR="/app/backend/data/cache/whisper/models" \
    SENTENCE_TRANSFORMERS_HOME="/app/backend/data/cache/embedding/models" \
    TIKTOKEN_ENCODING_NAME="cl100k_base" \
    TIKTOKEN_CACHE_DIR="/app/backend/data/cache/tiktoken" \
    HF_HOME="/app/backend/data/cache/embedding/models" \
    HOME=/root \
    WEBUI_BUILD_VERSION=${BUILD_HASH} \
    DOCKER=true

# --- 2. Copy Source Code and Set Up Environment ---
WORKDIR /app
COPY . .
RUN cp /home/node/* ./ -r

RUN mkdir -p /root/.cache/chroma && \
    echo -n 00000000-0000-0000-0000-000000000000 > /root/.cache/chroma/telemetry_user_id

# --- 3. Final Configuration ---
EXPOSE 8080
HEALTHCHECK CMD curl --silent --fail http://localhost:${PORT:-8080}/health | jq -ne 'input.status == true' || exit 1

# The default command to start your development script.
CMD [ "bash", "backend/dev.sh" ]

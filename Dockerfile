# syntax=docker/dockerfile:1
# Initialize device type args
ARG USE_CUDA=false
ARG USE_OLLAMA=false
ARG USE_CUDA_VER=cu128
ARG USE_EMBEDDING_MODEL=sentence-transformers/all-MiniLM-L6-v2
ARG USE_RERANKING_MODEL=""
ARG USE_TIKTOKEN_ENCODING_NAME="cl100k_base"
ARG BUILD_HASH=dev-build
ARG UID=0
ARG GID=0

######## WebUI frontend ########
FROM amazonlinux:2023 AS build
ARG BUILD_HASH

WORKDIR /app

# Install Node.js and git
RUN dnf install -y nodejs git

COPY package.json package-lock.json ./
RUN npm ci --force
COPY . .
ENV APP_BUILD_HASH=${BUILD_HASH}

# Increase memory for the Node.js build process
ENV NODE_OPTIONS="--max-old-space-size=4096"
RUN npm run build

######## WebUI backend ########
FROM amazonlinux:2023 AS base

# Re-declare ARGs for this stage
ARG USE_CUDA
ARG USE_OLLAMA
ARG USE_CUDA_VER
ARG USE_EMBEDDING_MODEL
ARG USE_RERANKING_MODEL
ARG USE_TIKTOKEN_ENCODING_NAME
ARG UID
ARG GID

# Environment variables
# NOTE: For production, pass secrets like OPENAI_API_KEY at runtime, not in the image.
ENV ENV=prod \
    PORT=8080 \
    USE_OLLAMA_DOCKER=${USE_OLLAMA} \
    USE_CUDA_DOCKER=${USE_CUDA} \
    USE_CUDA_DOCKER_VER=${USE_CUDA_VER} \
    OLLAMA_BASE_URL="/ollama" \
    OPENAI_API_BASE_URL="" \
    OPENAI_API_KEY="" \
    WEBUI_SECRET_KEY="" \
    SCARF_NO_ANALYTICS=true \
    DO_NOT_TRACK=true \
    ANONYMIZED_TELEMETRY=false \
    WHISPER_MODEL="base" \
    WHISPER_MODEL_DIR="/app/backend/data/cache/whisper/models" \
    RAG_EMBEDDING_MODEL=${USE_EMBEDDING_MODEL} \
    RAG_RERANKING_MODEL=${USE_RERANKING_MODEL} \
    SENTENCE_TRANSFORMERS_HOME="/app/backend/data/cache/embedding/models" \
    TIKTOKEN_ENCODING_NAME=${USE_TIKTOKEN_ENCODING_NAME} \
    TIKTOKEN_CACHE_DIR="/app/backend/data/cache/tiktoken" \
    HF_HOME="/app/backend/data/cache/embedding/models"

WORKDIR /app/backend
ENV HOME=/root

# Install Python 3.11
RUN dnf -y install python3.11 python3.11-devel python3.11-pip

# Create user/group
RUN if [ $GID -ne 0 ]; then \
    groupadd -g $GID app; \
    fi && \
    if [ $UID -ne 0 ]; then \
    useradd -m -u $UID -g $GID -d $HOME app; \
    fi

# Prepare cache directories
RUN mkdir -p $HOME/.cache/chroma && \
    echo -n 00000000-0000-0000-0000-000000000000 > $HOME/.cache/chroma/telemetry_user_id

# Install system dependencies and FFmpeg
RUN dnf -y install git gcc make cmake openssl-devel bzip2-devel libffi-devel \
    zlib-devel wget which jq file tar xz && \
    # Install FFmpeg from a static build
    curl -LO https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz && \
    tar -xf ffmpeg-release-amd64-static.tar.xz && \
    mv ffmpeg-*-amd64-static/ffmpeg /usr/local/bin/ && \
    mv ffmpeg-*-amd64-static/ffprobe /usr/local/bin/ && \
    rm -rf ffmpeg-*-amd64-static ffmpeg-release-amd64-static.tar.xz && \
    # Clean cache
    dnf clean all && \
    rm -rf /var/cache/dnf

# Install Ollama if needed
RUN if [ "$USE_OLLAMA" = "true" ]; then \
    curl -fsSL https://ollama.com/install.sh | sh; \
    fi

# Copy backend requirements
COPY --chown=$UID:$GID ./backend/requirements.txt ./requirements.txt

# Install Python dependencies using the specific python3.11 version
RUN if [ "$USE_CUDA" = "true" ]; then \
    python3.11 -m pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/${USE_CUDA_DOCKER_VER}; \
    else \
    python3.11 -m pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cpu; \
    fi && \
    python3.11 -m pip install --no-cache-dir uv && \
    uv pip install --system -r requirements.txt --no-cache-dir --python /usr/bin/python3.11 && \
    # Pre-download models
    python3.11 -c "import os; from sentence_transformers import SentenceTransformer; SentenceTransformer(os.environ['RAG_EMBEDDING_MODEL'], device='cpu')" && \
    python3.11 -c "import os; from faster_whisper import WhisperModel; WhisperModel(os.environ['WHISPER_MODEL'], device='cpu', compute_type='int8', download_root=os.environ['WHISPER_MODEL_DIR'])" && \
    python3.11 -c "import os; import tiktoken; tiktoken.get_encoding(os.environ['TIKTOKEN_ENCODING_NAME'])" && \
    chown -R $UID:$GID /app/backend/data/

# Copy frontend build
COPY --chown=$UID:$GID --from=build /app/build /app/build
COPY --chown=$UID:$GID --from=build /app/CHANGELOG.md /app/CHANGELOG.md
COPY --chown=$UID:$GID --from=build /app/package.json /app/package.json

# Copy backend code
COPY --chown=$UID:$GID ./backend .

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=30s --start-period=5s --retries=3 \
    CMD curl --silent --fail http://localhost:${PORT:-8080}/health | jq -ne 'input.status == true' || exit 1

USER $UID:$GID
ARG BUILD_HASH
ENV WEBUI_BUILD_VERSION=${BUILD_HASH} DOCKER=true

CMD [ "bash", "start.sh"]
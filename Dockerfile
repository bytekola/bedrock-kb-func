ARG USE_CUDA=false, USE_OLLAMA=false, USE_CUDA_VER=cu128, USE_EMBEDDING_MODEL=sentence-transformers/all-MiniLM-L6-v2, USE_RERANKING_MODEL="", USE_TIKTOKEN_ENCODING_NAME="cl100k_base", BUILD_HASH=dev-build-offline, UID=0, GID=0

######## 1. Build Frontend using the Frontend Builder ########
FROM open-webui-frontend-builder:latest AS build
ARG BUILD_HASH
WORKDIR /app
COPY . .
RUN npm run build


######## 2. Assemble the Image using the Backend Builder ########
FROM open-webui-backend-builder:latest AS final
ARG USE_OLLAMA, USE_CUDA, USE_CUDA_VER, USE_EMBEDDING_MODEL, USE_RERANKING_MODEL, UID, GID

ENV ENV=prod PORT=8080 USE_OLLAMA_DOCKER=${USE_OLLAMA} USE_CUDA_DOCKER=${USE_CUDA} USE_CUDA_DOCKER_VER=${USE_CUDA_VER} USE_EMBEDDING_MODEL_DOCKER=${USE_EMBEDDING_MODEL} USE_RERANKING_MODEL_DOCKER=${USE_RERANKING_MODEL} OLLAMA_BASE_URL="/ollama" OPENAI_API_BASE_URL="" OPENAI_API_KEY="" WEBUI_SECRET_KEY="" SCARF_NO_ANALYTICS=true DO_NOT_TRACK=true ANONYMIZED_TELEMETRY=false WHISPER_MODEL="base" WHISPER_MODEL_DIR="/app/backend/data/cache/whisper/models" RAG_EMBEDDING_MODEL="$USE_EMBEDDING_MODEL_DOCKER" RAG_RERANKING_MODEL="$USE_RERANKING_MODEL_DOCKER" SENTENCE_TRANSFORMERS_HOME="/app/backend/data/cache/embedding/models" TIKTOKEN_ENCODING_NAME="cl100k_base" TIKTOKEN_CACHE_DIR="/app/backend/data/cache/tiktoken" HF_HOME="/app/backend/data/cache/embedding/models" HOME=/root

WORKDIR /app/backend
# User setup
RUN if [ $UID -ne 0 ]; then if [ $GID -ne 0 ]; then addgroup --gid $GID app; fi; adduser --uid $UID --gid $GID --home $HOME --disabled-password --no-create-home app; fi
RUN mkdir -p $HOME/.cache/chroma && echo -n 00000000-0000-0000-0000-000000000000 > $HOME/.cache/chroma/telemetry_user_id
RUN chown -R $UID:$GID /app $HOME

# Copy the compiled frontend from the 'build' stage.
COPY --chown=$UID:$GID --from=build /app/build /app/build
COPY --chown=$UID:$GID --from=build /app/CHANGELOG.md /app/CHANGELOG.md
COPY --chown=$UID:$GID --from=build /app/package.json /app/package.json
COPY --chown=$UID:$GID backend .

EXPOSE 8080
HEALTHCHECK CMD curl --silent --fail http://localhost:${PORT:-8080}/health | jq -ne 'input.status == true' || exit 1
USER $UID:$GID
ARG BUILD_HASH
ENV WEBUI_BUILD_VERSION=${BUILD_HASH} DOCKER=true
CMD [ "bash", "start.sh"]

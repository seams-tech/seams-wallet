FROM mcr.microsoft.com/playwright:v1.55.0-noble

RUN npm install --global pnpm@11.11.0

WORKDIR /workspace
COPY . .
RUN pnpm install --frozen-lockfile

ENV SEAMS_INTENDED_SKIP_BUILD=1
EXPOSE 8080
CMD ["node", "tests/r150-hosted/probe/server.mjs"]

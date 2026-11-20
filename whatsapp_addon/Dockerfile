ARG BUILD_FROM
FROM ${BUILD_FROM}

RUN apk add --no-cache git npm

COPY . /
RUN chmod a+x /run.sh
RUN chmod a+x /finish.sh

# Baileys now comes from npm (pinned in package-lock.json). git is still
# needed for its libsignal dependency.
RUN npm ci --omit=dev || npm install --omit=dev --force

EXPOSE 3000
CMD [ "/run.sh" ]
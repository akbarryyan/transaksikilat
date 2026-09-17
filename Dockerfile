FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache openssl libc6-compat

COPY package.json package-lock.json* ./
COPY prisma ./prisma

RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

COPY . .

ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_AUTH_OTP_ENABLED
ARG NEXT_PUBLIC_BASE_URL
ARG NEXT_PUBLIC_REQUIRE_LOGIN_TO_PURCHASE
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_AUTH_OTP_ENABLED=$NEXT_PUBLIC_AUTH_OTP_ENABLED \
    NEXT_PUBLIC_BASE_URL=$NEXT_PUBLIC_BASE_URL \
    NEXT_PUBLIC_REQUIRE_LOGIN_TO_PURCHASE=$NEXT_PUBLIC_REQUIRE_LOGIN_TO_PURCHASE

RUN npx prisma generate

RUN npm run build

ENV NODE_ENV=production
ENV PORT=3003

EXPOSE 3003

CMD ["npm", "run", "start"]

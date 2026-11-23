# amarchy-relay's image: one static binary on distroless (CA certificates
# and a nonroot user, nothing else). Built from relay/:
#   docker build -t amarchy-relay .
FROM golang:1.27 AS build
WORKDIR /src
ENV CGO_ENABLED=0 GOTOOLCHAIN=local GOFLAGS=-trimpath
COPY go.mod ./
COPY cmd ./cmd
COPY internal ./internal
RUN go build -ldflags="-s -w" -o /out/amarchy-relay ./cmd/amarchy-relay

FROM gcr.io/distroless/static-debian13:nonroot
COPY --from=build /out/amarchy-relay /amarchy-relay
USER nonroot:nonroot
# Cloud Run and Fly set PORT; 8080 when nothing does.
EXPOSE 8080
ENTRYPOINT ["/amarchy-relay"]

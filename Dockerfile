FROM public.ecr.aws/d3j8x8q7/olympus-base-typescript:latest
WORKDIR /app
COPY . .
RUN npm ci
CMD ["/bin/bash"]

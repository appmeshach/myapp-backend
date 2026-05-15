import axios from "axios";

const API_BASE_URL = "http://10.0.2.2:3000/v1";

export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
});

export const DEMO_BUYER_TOKEN =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoiNTY3MjY0MzctODUzMC00ZTc0LTgyYjAtYzc4ZjdiZTA5ZmJjIiwicm9sZSI6IkJVWUVSIiwiaWF0IjoxNzc4NDM2NjE5LCJleHAiOjE3NzkwNDE0MTl9.cM7N0b11kP52Sk3z6aTEv4az-eHNbvtdAqCRhi2YXF0";

export const IS_SIGNED_IN = !!DEMO_BUYER_TOKEN;

api.interceptors.request.use((config) => {
  config.headers.Authorization = `Bearer ${DEMO_BUYER_TOKEN}`;
  return config;
});
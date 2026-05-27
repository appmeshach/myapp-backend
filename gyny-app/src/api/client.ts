import axios from "axios";

const API_BASE_URL = "http://10.0.2.2:3000/v1";

export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
});

export const DEMO_BUYER_TOKEN =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoiYWM5NTM4NTktMTU2ZC00NDEwLWFiNGEtMjhiMWM2YTBjMDk3Iiwicm9sZSI6IkJVWUVSIiwiaWF0IjoxNzc5MTk5NTI5LCJleHAiOjE3Nzk4MDQzMjl9.HNZs8P26BwfVNerIAEHww5WPWxsO9n4TovSTjH6GHWw";

export const IS_SIGNED_IN = !!DEMO_BUYER_TOKEN;

api.interceptors.request.use((config) => {
  config.headers.Authorization = `Bearer ${DEMO_BUYER_TOKEN}`;
  return config;
});
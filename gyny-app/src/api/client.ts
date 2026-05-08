import axios from "axios";

const API_BASE_URL = "http://10.0.2.2:3000/v1";

export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
});

export const DEMO_BUYER_TOKEN =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoiMjkzMTc0NGYtMWZlYS00N2ViLWI0OWEtNDAxZTIwOWQxMzFiIiwicm9sZSI6IkJVWUVSIiwiaWF0IjoxNzc2ODAzNTczLCJleHAiOjE3Nzc0MDgzNzN9.jhcsv4rATkOeFkqQYf1vWxJ3Mm9Twwo6n_rEPocILkU";

export const IS_SIGNED_IN = !!DEMO_BUYER_TOKEN;

api.interceptors.request.use((config) => {
  config.headers.Authorization = `Bearer ${DEMO_BUYER_TOKEN}`;
  return config;
});
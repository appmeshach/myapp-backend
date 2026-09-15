import { createActivationPaymentHandler } from '../_shared/activation-payment.ts';
import { runtimePaymentBackend } from '../_shared/payment-runtime.ts';
import { serve } from '../_shared/face-runtime.ts';

// No provider selection through environment variables and no fake production adapter.
serve(createActivationPaymentHandler(runtimePaymentBackend()));

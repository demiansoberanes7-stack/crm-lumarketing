import { AsyncLocalStorage } from "node:async_hooks";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";
import { getDb, schema } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { AUTH_RATE_LIMIT, checkDistributedRateLimit } from "@/lib/rate-limit";
import {
  isInstanceOwner,
  onUserCreated,
  resolveActiveOrganizationId,
} from "@/server/auth/on-signup";
import { isPublicSignupAllowed } from "@/server/auth/registration";

/**
 * Contexto interno del proceso: permite que el alta de cuentas hechas por el
 * servidor —cuentas de equipo y altas de cliente (Ajustes → Equipo)— atraviese
 * el gate de registro cerrado. No es alcanzable desde fuera: solo envuelve
 * llamadas server-side.
 */
const globalForSignup = globalThis as unknown as {
  __voceroInternalSignup?: AsyncLocalStorage<boolean>;
};

// En globalThis: los módulos pueden evaluarse más de una vez (una por ruta en
// dev) y todas las copias deben compartir el mismo contexto.
function internalSignupContext(): AsyncLocalStorage<boolean> {
  if (!globalForSignup.__voceroInternalSignup) {
    globalForSignup.__voceroInternalSignup = new AsyncLocalStorage<boolean>();
  }
  return globalForSignup.__voceroInternalSignup;
}

export function runInternalSignup<T>(fn: () => Promise<T>): Promise<T> {
  return internalSignupContext().run(true, fn);
}

function isInternalSignup(): boolean {
  return internalSignupContext().getStore() === true;
}

const RATE_LIMITED_PATHS = new Set(["/sign-in/email", "/sign-up/email"]);

function createAuth() {
  const env = getEnv();
  const extraOrigins = (process.env.TRUSTED_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  // Verificación de email SOLO si hay SMTP configurado. Exigirla sin SMTP
  // dejaría a todo usuario nuevo fuera sin forma de verificar — el guard es
  // de activación progresiva, no un martillo.
  const smtpConfigured = Boolean(
    env.AUTH_SMTP_HOST && env.AUTH_SMTP_USER && env.AUTH_SMTP_PASSWORD && env.AUTH_SMTP_FROM
  );
  return betterAuth({
    baseURL: env.APP_BASE_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: extraOrigins,
    database: drizzleAdapter(getDb(), {
      provider: "pg",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
        organization: schema.organization,
        member: schema.member,
        invitation: schema.invitation,
      },
    }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: smtpConfigured,
      minPasswordLength: 8,
    },
    ...(smtpConfigured
      ? {
          emailVerification: {
            sendOnSignUp: true,
            autoSignInAfterVerification: true,
            sendVerificationEmail: async ({ user, url }: { user: { email: string }; url: string }) => {
              const nodemailer = await import("nodemailer");
              const transporter = nodemailer.createTransport({
                host: env.AUTH_SMTP_HOST,
                port: env.AUTH_SMTP_PORT,
                secure: env.AUTH_SMTP_PORT === 465,
                auth: { user: env.AUTH_SMTP_USER, pass: env.AUTH_SMTP_PASSWORD },
              });
              await transporter.sendMail({
                from: env.AUTH_SMTP_FROM,
                to: user.email,
                subject: "Verifica tu correo electrónico",
                text: `Confirma tu correo abriendo este enlace:\n\n${url}`,
                html: `<p>Confirma tu correo electrónico para activar tu cuenta.</p><p><a href="${url}">Verificar correo</a></p>`,
              });
            },
          },
        }
      : {}),
    plugins: [
      organization({
        creatorRole: "owner",
        // El plugin expone POST /api/auth/organization/create a CUALQUIER sesión
        // válida. Sin este guard, un miembro de un negocio crea un tenant propio
        // y sin sembrar (embudo, canales y perfil de agente ausentes), saltando
        // el control de quien opera la instancia. El alta legítima sigue por
        // Ajustes → Equipo, que escribe la organización sembrada directamente.
        allowUserToCreateOrganization: async (user) => isInstanceOwner(user.id),
      }),
    ],
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        // Rate limit por IP en login/registro (FR-062): 10 / 10 min → 429.
        if (RATE_LIMITED_PATHS.has(ctx.path)) {
          // El PRIMER hop de X-Forwarded-For lo escribe el cliente: con él se
          // podía esquivar el rate limit mandando un header distinto por
          // request. El hop que importa es el ÚLTIMO (el que agrega el proxy
          // de confianza: Caddy/Traefik). x-real-ip lo pisa el proxy y es
          // aún más directo, así va primero.
          const forwarded = ctx.headers?.get("x-forwarded-for");
          const lastHop = forwarded
            ?.split(",")
            .map((h) => h.trim())
            .filter(Boolean)
            .at(-1);
          const ip =
            ctx.headers?.get("x-real-ip") ||
            lastHop ||
            "local";
          const result = await checkDistributedRateLimit(`${ctx.path}:${ip}`, AUTH_RATE_LIMIT);
          if (!result.allowed) {
            throw new APIError("TOO_MANY_REQUESTS", {
              message: "Demasiados intentos; espera unos minutos",
            });
          }
        }
        // Registro público cerrado tras la primera organización (FR-060). Con
        // `ALLOW_SIGNUP=true` se reabre y cada alta nueva pasa a ser OTRO
        // negocio: la sesión sin membresía aterriza en /crear-negocio, no en el
        // negocio que ya existía.
        if (ctx.path === "/sign-up/email") {
          if (!isInternalSignup() && !(await isPublicSignupAllowed())) {
            throw new APIError("FORBIDDEN", {
              message: "El registro público está cerrado en esta instancia",
            });
          }
        }
      }),
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            await onUserCreated(user.id, user.name);
          },
        },
      },
      session: {
        create: {
          before: async (session) => {
            const organizationId = await resolveActiveOrganizationId(
              session.userId
            );
            return {
              data: { ...session, activeOrganizationId: organizationId },
            };
          },
        },
      },
    },
  });
}

type Auth = ReturnType<typeof createAuth>;

const globalForAuth = globalThis as unknown as { __voceroAuth?: Auth };

export function getAuth(): Auth {
  if (!globalForAuth.__voceroAuth) globalForAuth.__voceroAuth = createAuth();
  return globalForAuth.__voceroAuth;
}

import { z } from 'zod'

export const ENTRY_TYPES = [
  'experience',
  'credential',
  'accomplishment',
  'skill',
  'education',
] as const

export const ProfileEntrySchema = z.object({
  id: z.string().uuid(),
  type: z.enum(ENTRY_TYPES),
  title: z.string().min(1, 'Title is required'),
  content: z.string(),
  tags: z.array(z.string()),
  start_date: z.string().nullable(),
  end_date: z.string().nullable(),
  created_at: z.string(),
})

export type ProfileEntry = z.infer<typeof ProfileEntrySchema>

export const LanguageItemSchema = z.object({
  name: z.string(),
  proficiency: z.string(),
})
export type LanguageItem = z.infer<typeof LanguageItemSchema>

export const CitizenshipItemSchema = z.object({
  country: z.string(),
  status: z.string(),
})
export type CitizenshipItem = z.infer<typeof CitizenshipItemSchema>

export const UserProfileSchema = z.object({
  id: z.number(),
  /** Effective YOE: the override when set, else the computed value. */
  yoe: z.number().nonnegative(),
  /** Always the computed value, regardless of override. */
  yoe_computed: z.number().nonnegative(),
  /** User-set override; null means "use computed". */
  yoe_override: z.number().nullable(),
  yoe_industry: z.array(z.string()),
  languages: z.array(LanguageItemSchema),
  citizenship: z.array(CitizenshipItemSchema),
  drivers_license: z.boolean(),
})

export const UserQualificationsSchema = z.object({
  yoe_industry: z.array(z.string()),
  languages: z.array(LanguageItemSchema),
  citizenship: z.array(CitizenshipItemSchema),
  drivers_license: z.boolean(),
})

export type UserQualificationsInput = z.infer<typeof UserQualificationsSchema>

export type UserProfile = z.infer<typeof UserProfileSchema>

export const CreateProfileEntrySchema = ProfileEntrySchema.omit({
  id: true,
  created_at: true,
})
export type CreateProfileEntryInput = z.infer<typeof CreateProfileEntrySchema>

export const UpdateProfileEntrySchema = CreateProfileEntrySchema.partial()
export type UpdateProfileEntryInput = z.infer<typeof UpdateProfileEntrySchema>

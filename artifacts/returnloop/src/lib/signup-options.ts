const otherSpecialization = 'Other specialization';

export const OTHER_PROGRAM = 'Other / institution-specific program';
export const OTHER_SPECIALIZATION = otherSpecialization;

const engineeringSpecializations = [
  'Computer Science Engineering',
  'CSE (Artificial Intelligence & Machine Learning)',
  'CSE (Data Science)',
  'Information Technology',
  'Electronics & Communication Engineering',
  'Electrical Engineering',
  'Mechanical Engineering',
  'Civil Engineering',
  otherSpecialization,
];

export const PROGRAM_OPTIONS: { name: string; specializations: string[] }[] = [
  { name: 'B.Tech', specializations: engineeringSpecializations },
  { name: 'B.E.', specializations: engineeringSpecializations },
  { name: 'BBA', specializations: ['Business Management', 'Marketing', 'Finance', 'Human Resources', 'Business Analytics', otherSpecialization] },
  { name: 'B.Com', specializations: ['Accounting', 'Finance', 'Business Management', otherSpecialization] },
  { name: 'BCA', specializations: ['Computer Applications', 'Information Technology', 'Data Science', otherSpecialization] },
  { name: 'MBA', specializations: ['Business Management', 'Marketing', 'Finance', 'Human Resources', 'Business Analytics', otherSpecialization] },
  { name: 'MCA', specializations: ['Computer Applications', 'Software Development', 'Data Science', otherSpecialization] },
  { name: 'M.Tech', specializations: ['Computer Science Engineering', 'Artificial Intelligence & Machine Learning', 'Data Science', 'Electronics & Communication Engineering', otherSpecialization] },
  { name: 'M.Sc.', specializations: ['Computer Science', 'Data Science', 'Mathematics', 'Physics', 'Chemistry', otherSpecialization] },
  { name: 'B.Sc.', specializations: ['Computer Science', 'Data Science', 'Mathematics', 'Physics', 'Chemistry', otherSpecialization] },
  { name: 'B.A.', specializations: ['Economics', 'English', 'Psychology', otherSpecialization] },
  { name: 'B.Pharm.', specializations: ['Pharmacy', otherSpecialization] },
  { name: 'Diploma', specializations: engineeringSpecializations },
  { name: OTHER_PROGRAM, specializations: [] },
];

export const SECTION_OPTIONS = [
  ...Array.from({ length: 26 }, (_, index) => String.fromCharCode(65 + index)),
  ...Array.from({ length: 10 }, (_, index) => String(index + 1)),
  'A1', 'A2', 'B1', 'B2', 'C1', 'C2',
  'P1', 'P2', 'P3', 'P4', 'P5', 'P1Z', 'P2Z', 'P3Z', 'P4Z',
  'X1', 'X2', 'Y1', 'Y2', 'Z1', 'Z2',
];
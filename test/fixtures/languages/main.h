#ifndef MAIN_H // include guard
#define MAIN_H

#include <stddef.h>

#define LIMIT 64

typedef struct {
  size_t length;
  char *data;
} buffer;

size_t buffer_length(const buffer *value);

#endif
